import { randomUUID } from 'crypto';

import * as Sentry from '@sentry/node';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda';
import { FetchError, ResponseError } from 'auth0';
import { CustomError } from '@httptoolkit/util';

import log from 'loglevel';

log.setLevel(process.env.LOGLEVEL as any ?? 'info');

const logId = randomUUID().slice(0, 8);
const originalFactory = log.methodFactory;
log.methodFactory = function (
    method: log.LogLevelNames,
    level: log.LogLevelNumbers,
    logger: string | symbol
) {
    return originalFactory(method, level, logger).bind(console, `${logId}:`);
};
log.rebuild();

const { SENTRY_DSN, VERSION } = process.env;

let sentryInitialized = false;
export function initSentry() {
    if (sentryInitialized) return;

    if (SENTRY_DSN) {
        Sentry.init({ dsn: SENTRY_DSN, release: VERSION });
        sentryInitialized = true;
        log.info("Sentry initialized");
    }
}

export class StatusError extends CustomError {
    constructor(
        public readonly statusCode: number,
        message: string
    ) {
        super(message);
    }
}

function getErrorCause(error: any) {
    let underlyingCause = error;

    while ((underlyingCause as any)?.cause) {
        underlyingCause = (underlyingCause as any).cause;
    }

    return underlyingCause;
}

const ellipsise = (msg: string) => {
    if (msg?.length > 100) {
        return msg.slice(0, 97) + '...';
    } else {
        return msg;
    }
}

export const formatErrorMessage = (error: any): string => {
    if (error.name === 'AggregateError') {
        return `[AggregateError]:\n${
            error.errors?.map((error: Error) => ` - ${formatErrorMessage(error)}`).join('\n')
        }`
    }

    // Auth0 response error messages aren't very helpful:
    if (error instanceof ResponseError) {
        return `Auth0 response error (returned ${error.statusCode}: ${ellipsise(error.body) || '<empty body>'})`
    }

    // Always skip logging FetchError messages - they're an annoying Auth0 wrapper
    if (error instanceof FetchError) {
        return `Auth0 FetchError - ${formatErrorMessage(error.cause)}`;
    }

    const cause = getErrorCause(error);
    if (cause !== error) {
        return `${error.message ?? error} (caused by ${formatErrorMessage(cause)})`;
    }

    return error.message ?? error;
};

export async function reportError(error: Error | ResponseError | string, metadata?: {
    eventContext?: APIGatewayProxyEvent,
    cause?: Error
}) {
    // Recurse down to find the underlying causes, if possible:
    const underlyingCause = getErrorCause(metadata?.cause) ?? getErrorCause(error);

    if (error instanceof ResponseError || error instanceof FetchError) {
        log.error(`Upstream Auth0 request failed with: ${formatErrorMessage(error)}`);
    } else {
        log.error(error);
    }

    if (underlyingCause !== error) {
        log.debug(underlyingCause);
    }

    if (!sentryInitialized) return;

    Sentry.withScope((scope) => {
        scope.addEventProcessor((event) => {
            if (metadata?.eventContext) {
                const eventContext = metadata?.eventContext;
                const request = event.request || {};
                request.method = request.method || eventContext.httpMethod;
                request.url = request.url || eventContext.path;
                request.headers = request.headers || eventContext.headers;
                event.request = request;
            }

            event.extra = event.extra ?? {};

            if (underlyingCause) {
                Object.assign(event.extra, {
                    cause: underlyingCause
                });
            }

            return event;
        });

        if (typeof error === 'string') {
            Sentry.captureMessage(error);
        } else {
            Sentry.captureException(error);
        }
    });

    await Sentry.flush();
}

type ApiHandler = Handler<APIGatewayProxyEvent, APIGatewayProxyResult>;

export function catchErrors(handler: ApiHandler): ApiHandler {
    return async function (this: any, event, context) {
        // Make sure AWS doesn't wait for an empty event loop, as that
        // can break things with Sentry
        context.callbackWaitsForEmptyEventLoop = false;

        // This catches sync errors & promise rejections, because we're async
        try {
            return await (handler.call as any)(this, ...arguments);
        } catch (e: any) {
            const specificFailureStatus =
                // The handler threw an error for a specific status response (e.g. 401):
                e instanceof StatusError
                    ? e.statusCode
                // Some kind of upstream Auth0 error:
                : e instanceof ResponseError || e instanceof FetchError
                    ? 502
                // Generic error (this will be thrown -> automatic 500 later)
                : undefined;

            await Promise.all([
                // Report the handler failure itself, as a separate type of error to track:
                reportError(`${
                    event.httpMethod ?? '???'
                } request to ${event.path} failed with ${
                    specificFailureStatus ?? 500
                } due to: ${formatErrorMessage(e)}`, {
                    eventContext: event,
                    cause: e
                }),

                // Report the specific low-level exception too, to track both independently:
                reportError(e, { eventContext: event })
            ]);

            if (specificFailureStatus) {
                return {
                    statusCode: specificFailureStatus,
                    headers: { 'Cache-Control': 'no-store' },
                    body: e.message
                }
            } else {
                throw e;
            }
        }
    };
}