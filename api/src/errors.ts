import * as Sentry from '@sentry/node';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda';
import { CustomError } from '@httptoolkit/util';

import * as log from 'loglevel';
log.setLevel(process.env.LOGLEVEL as any ?? 'info');

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

interface Auth0RequestError extends Error {
    // See https://github.com/auth0/node-auth0/blob/master/src/errors.js
    statusCode: number | string | undefined,
    requestInfo: { method?: string, url?: string },
    originalError: Error
};

export class StatusError extends CustomError {
    constructor(
        public readonly statusCode: number,
        message: string
    ) {
        super(message);
    }
}

export const formatErrorMessage = (error: any) => error.name === 'AggregateError'
    ? `[AggregateError]:\n${
        error.errors?.map((error: Error) => ` - ${error.message}`).join('\n')
    }`
    : (error.message ?? error);

export async function reportError(error: Error | Auth0RequestError | string, metadata?: {
    eventContext?: APIGatewayProxyEvent,
    cause?: Error
}) {
    if (error instanceof Error && 'requestInfo' in error) {
        log.error(`Auth0 ${
            (error.requestInfo.method || '???').toUpperCase()
        } request to '${
            error.requestInfo.url
        }' failed with status ${error.statusCode}: ${formatErrorMessage(error)}`);
        log.debug(`Caused by:`, error);
    } else {
        log.error(error);
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

            if (error instanceof Error && 'originalError' in error) {
                Object.assign(event.extra, {
                    originalName: error.originalError.name,
                    originalMessage: error.originalError.message,
                    originalStack: error.originalError.stack
                });
            }

            if (metadata?.cause) {
                Object.assign(event.extra, {
                    cause: metadata.cause
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
            await Promise.all([
                // Report the URL failure itself as a separate type of error to track:
                reportError(`${
                    event.httpMethod ?? '???'
                } request to ${event.path} failed with ${
                    e instanceof StatusError
                    ? e.statusCode
                    : '500'
                } due to ${formatErrorMessage(e)}`, {
                    eventContext: event,
                    cause: e
                }),
                // Report the specific low-level exception too, to track both independently:
                reportError(e, { eventContext: event })
            ]);

            if (e instanceof StatusError) {
                return {
                    statusCode: e.statusCode,
                    headers: { 'Cache-Control': 'no-store' },
                    body: e.message
                }
            } else {
                throw e;
            }
        }
    };
}