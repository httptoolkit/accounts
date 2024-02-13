import * as log from 'loglevel';
import { formatErrorMessage } from './errors';
import { delay } from '@httptoolkit/util';

interface RetryOptions {
    retries: number;
    delay: number;

    /**
     * Set this option to directly throw (skipping retries) for some errors.
     * This callback should return undefined to continue retries, or an error
     * (the given error, or a replacement) to throw immediately.
     */
    shouldThrow?: (error: any) => Error | undefined;
}

export async function runWithRetries<R, F extends () => Promise<R>>(
    name: string,
    fnCall: F,
    optionsParam: Partial<RetryOptions> = {}
): Promise<R> {
    const options = { retries: 3, delay: 1000, ...optionsParam };

    try {
        return await fnCall();
    } catch (e) {
        // Callers can provide a callback to actively thrown when seeing known-bad errors
        // (like 401 in authentication requests). The callback can override the specific error.
        if (options.shouldThrow) {
            const errorToThrow = options.shouldThrow(e);
            if (errorToThrow) throw errorToThrow;
        }

        if (options.retries <= 0) {
            log.warn(`Out of retries for ${name} - failing`)
            throw e;
        }

        log.info(`${name} failed with ${formatErrorMessage(e)}, retrying in ${options.delay}ms`);

        await delay(options.delay);
        return runWithRetries(name, fnCall, { ...options, retries: options.retries - 1 });
    }
}

export function withRetries<F extends (...args: any[]) => any>(
    name: string,
    fnDefn: F,
    options: Partial<RetryOptions> = {}
): (...funcArgs: Parameters<F>) => Promise<Awaited<ReturnType<F>>> {
    return async function (this: any, ...args: Parameters<F>): Promise<Awaited<ReturnType<F>>> {
        return await runWithRetries(name, () => fnDefn.apply(this, args), options);
    };
}