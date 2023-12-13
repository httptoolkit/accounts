import * as Sentry from '@sentry/browser';

// N.b. this can't use destructuring, or it won't work with Webpack's
// EnvironmentPlugin that inserts these values at build time:
const SENTRY_DSN = process.env.SENTRY_DSN;
const VERSION = process.env.VERSION;

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