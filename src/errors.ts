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

    const scope = Sentry.getCurrentHub().getScope();

    // We have to play some funky games here to make sure we can wait for the event
    // see https://github.com/getsentry/sentry-javascript/issues/1449 for context.
    if (typeof error === 'string') {
        await Sentry.getCurrentHub().getClient().captureMessage(error, scope);
    } else {
        await Sentry.getCurrentHub().getClient().captureException(error, scope);
    }
}

export function catchErrors(handler: Handler): Handler {
    return async function(event, context) {
        // Make sure AWS doesn't wait for an empty event loop, as that can
        // break things with Sentry
        context.callbackWaitsForEmptyEventLoop = false;
        try {
            return await handler.call(this, ...arguments);
        } catch(e) {
            // Catches sync errors & promise rejections, because we're async
            await reportError(e);
            throw e;
        }
    };
}