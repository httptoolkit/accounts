import * as Sentry from '@sentry/browser';

const { SENTRY_DSN, VERSION } = process.env;

let sentryInitialized = false;

export function initSentry() {
    if (SENTRY_DSN) {
        Sentry.init({
            dsn: SENTRY_DSN,
            release: VERSION
        });
        sentryInitialized = true;
    }
}

export function reportError(error: Error | string, metadata: object = {}) {
    console.log('Reporting error:', error);
    if (!sentryInitialized) return;

    Sentry.withScope((scope) => {
        Object.entries(metadata).forEach(([key, value]) => {
            scope.setExtra(key, value);
        });

        if (typeof error === 'string') {
            Sentry.captureMessage(error);
        } else {
            Sentry.captureException(error);
        }
    });
}