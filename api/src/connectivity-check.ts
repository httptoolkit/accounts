import log from 'loglevel';

import { formatErrorMessage } from './errors.ts';

if (process.env.ENABLE_CONNECTIVITY_CHECKS) {
    setInterval(() => {
        const startTime = Date.now();
        fetch(`https://${process.env.AUTH0_DOMAIN}/api/`)
        .then(() => {
            const duration = Date.now() - startTime;
            log.warn(`Connectivity OK (${duration}ms)`);
        }) // We ignore status - it's 401 anyway
        .catch((error) => {
            const duration = Date.now() - startTime;
            log.error(
                `Connectivity check to Auth0 failed - '${
                    error.code ?? formatErrorMessage(error)
                }' after ${duration}ms`
            );
            log.debug(error);
        });
    }, 5_000).unref();
}