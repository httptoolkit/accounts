import * as Sentry from '@sentry/node';
import { Handler } from 'aws-lambda';

const { SENTRY_DSN, COMMIT_REF } = process.env;

let sentryInitialized = false;
export function initSentry() {
    if (SENTRY_DSN) {
        Sentry.init({ dsn: SENTRY_DSN, release: COMMIT_REF });
        sentryInitialized = true;
    }
}

export async function reportError(error: Error | string) {
    console.warn(error);
    if (!sentryInitialized) return;

    if (typeof error === 'string') {
        Sentry.captureMessage(error);
    } else {
        Sentry.captureException(error);
    }

    // Cast required temporarily - this is new in 4.6.0, and isn't in
    // the typings quite yet.
    await (Sentry as any).flush();
}

export function catchErrors(handler: Handler): Handler {
    return async function (_event, context) {
        // Make sure AWS doesn't wait for an empty event loop, as that
        // can break things with Sentry
        context.callbackWaitsForEmptyEventLoop = false;
        try {
            return await handler.call(this, ...arguments);
        } catch (e) {
            // Catches sync errors & promise rejections, because we're async
            await reportError(e);
            throw e;
        }
    };
}