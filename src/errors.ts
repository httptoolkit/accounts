import * as Sentry from '@sentry/node';

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