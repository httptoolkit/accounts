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

export function reportError(error: Error | string) {
    console.warn(error);
    if (!sentryInitialized) return;

    if (typeof error === 'string') {
        Sentry.captureMessage(error);
    } else {
        Sentry.captureException(error);
    }
}

export function catchErrors(handler: Handler): Handler {
    return async function() {
        try {
            return await handler.call(this, ...arguments);
        } catch(e) {
            // Catches sync errors & promise rejections, because we're async
            reportError(e);
            throw e;
        }
    };
}