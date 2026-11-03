import log from 'loglevel';

import { SKU } from '@httptoolkit/accounts';
import { CustomError, delay } from '@httptoolkit/util';

import { getPaddleIdForSku } from './paddle.ts';
import { getSkuInterval } from './products.ts';
import { formatErrorMessage } from './errors.ts';

const PROFITWELL_PRIVATE_TOKEN = process.env.PROFITWELL_PRIVATE_TOKEN;
const PROFITWELL_API_BASE_URL = process.env.PROFITWELL_API_BASE_URL
    ?? 'https://api.profitwell.com';

interface Traits {
    'Payment provider'?: string,
    'Country code'?: string
}

const DEFAULT_PROFITWELL_RETRIES = 10;

export class AccountingError extends CustomError {
    constructor(
        statusCode: number,
        message: string,
        public readonly body: string,
        public readonly retryAfterMs?: number
    ) {
        super(message, { statusCode });
    }
}

const isRetryableStatus = (status: number) => status === 429 || status >= 500;

function getRetryAfterMs(response: Response): number | undefined {
    const header = response.headers.get('retry-after');
    if (!header) return undefined;

    const seconds = Number(header);
    if (!isNaN(seconds)) return seconds * 1000;

    const date = Date.parse(header);
    if (!isNaN(date)) return Math.max(date - Date.now(), 0);

    return undefined;
}

// Exponentially increasing retries (maximum ~8 hours total), or longer if Profitwell asks:
function getRetryDelayMs(retries: number, retryAfterMs?: number) {
    const backoff = 1000 * (3 ** (DEFAULT_PROFITWELL_RETRIES - retries));
    return Math.max(backoff, retryAfterMs ?? 0);
}

// Retries network errors, rate limits & server errors. Other failures are returned as-is.
async function fetchWithRetries(
    description: string,
    url: string,
    init: RequestInit,
    retries = DEFAULT_PROFITWELL_RETRIES
): Promise<Response> {
    let retryAfterMs: number | undefined;

    try {
        const response = await fetch(url, init);
        if (!isRetryableStatus(response.status) || retries <= 0) return response;

        const body = await response.text().catch(() => '');
        log.warn(`${response.status} Profitwell ${description} response: ${body}`);
        retryAfterMs = getRetryAfterMs(response);
    } catch (e) {
        if (retries <= 0) throw e;
        log.warn(`Profitwell ${description} request failed: ${formatErrorMessage(e)}`);
    }

    const sleepTime = getRetryDelayMs(retries, retryAfterMs);
    log.info(`Sleeping for ${sleepTime} between ${description} retries`);
    await delay(sleepTime, { unref: true });
    log.debug(`Retrying ${description}...`);

    return fetchWithRetries(description, url, init, retries - 1);
}

// Attempt to update the user to log subscription metadata (e.g. the provider used) so
// we can work out where the actual money is later on.
export async function setRevenueTraits(email: string, traits: Traits, retries = DEFAULT_PROFITWELL_RETRIES) {
    log.debug(`Setting traits for ${email} (retry ${DEFAULT_PROFITWELL_RETRIES - retries})`);

    await Promise.all(Object.entries(traits).map(async ([category, trait]) => {
        if (!trait) return;

        const response = await fetch(`${PROFITWELL_API_BASE_URL}/v2/customer_traits/trait/`, {
            method: 'PUT',
            headers: {
                'Authorization': PROFITWELL_PRIVATE_TOKEN!,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, category, trait })
        });

        const responseBody = await response.text().catch(log.warn);

        if (response.status === 400 && responseBody?.includes('Customer already has trait')) {
            // This is totally fine, if it's already set then we're happy regardless.
            return;
        } else if (response.status === 400 && responseBody?.includes('hit trait limit')) {
            // Too many traits (max 100 => most likely not a top 100 country). Annoying but
            // an unavoidable limitation of Profitwell, so we just ignore it.
            console.log(`Unable to log ${trait}=${category} for ${email} due to trait limit`);
            return;
        } else if (!response.ok) {
            log.warn(`${response.status} Profitwell traits response: ${responseBody}`);
            throw new AccountingError(
                response.status,
                `Failed to set Profitwell ${category}:${trait} on ${email} (${response.status})`,
                responseBody ?? '',
                getRetryAfterMs(response)
            );
        } else {
            // Trait set OK, all good.
            return;
        }
    })).catch(async (e) => {
        // Retry failures, to work around intermittent connection problems or race conditions
        // where a parallel process (e.g. Paddle's Profitwell integration) or Profitwell's
        // own processing hasn't completed yet and so the customer isn't recognized.
        if (retries > 0) {
            const sleepTime = getRetryDelayMs(
                retries,
                e instanceof AccountingError ? e.retryAfterMs : undefined
            );

            log.info(`Sleeping for ${sleepTime} between ${email} trait retries`);
            await delay(sleepTime, { unref: true });
            log.debug(`Retrying ${email} trait...`);

            return setRevenueTraits(email, traits, retries - 1);
        } else {
            log.warn('Out of retries, failing...')
            throw e;
        }
    });

    log.info(`Trait update for ${email} complete`);
}

export async function recordSubscription(
    email: string,
    subscription: {
        id: string,
        sku: SKU,
        currency: string,
        price: number,
        effectiveDate: Date
    },
    traits: Traits
) {
    const interval = getSkuInterval(subscription.sku);
    if (interval === 'perpetual') return; // We don't record these, they don't matter
    const profitWellInterval = interval === 'monthly'
        ? 'month'
        : 'year';

    // Record the new subscription in Profitwell:
    const response = await fetchWithRetries(`${email} sub creation`, `${PROFITWELL_API_BASE_URL}/v2/subscriptions/`, {
        method: 'POST',
        headers: {
            'Authorization': PROFITWELL_PRIVATE_TOKEN!,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            email: email,
            user_alias: email,
            subscription_alias: subscription.id,
            plan_id: getPaddleIdForSku(subscription.sku),
            plan_interval: profitWellInterval,
            plan_currency: subscription.currency.toLowerCase(),
            value: Math.round(subscription.price * 100), // Integer cents (or equivalent)
            effective_date: Math.round(subscription.effectiveDate.getTime() / 1000)
        })
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        log.warn(`${response.status} Profitwell sub creation response:`);
        log.warn(body);

        // Profitwell has a ridiculous 8-subscription limit per user. To work around this, we fudge
        // the email addresses to treat this as a 'new' user instead. Silly but whatever.
        if (
            response.status === 400 &&
            body.includes("Subscription limit of 8 reached for this user. Cannot create more.")
        ) {
            return recordSubscription(
                email.replace(/\.([^.@])+$/, `.${new Date().getFullYear().toString().slice(2)}`),
                // replace (for example) .com with .24 (36 char limit on emails!)
                subscription,
                traits
            );
        }

        throw new AccountingError(response.status, `Unexpected ${response.status} from Profitwell`, body);
    }

    await setRevenueTraits(email, traits);
}

export async function recordCancellation(
    subscriptionId: string,
    effectiveDate: number
) {
    // Record the subscription cancellation in Profitwell:
    const response = await fetchWithRetries(`${subscriptionId} sub cancellation`, `${PROFITWELL_API_BASE_URL}/v2/subscriptions/${
        subscriptionId
    }?effective_date=${
        effectiveDate
    }`, {
        method: 'DELETE',
        headers: {
            'Authorization': PROFITWELL_PRIVATE_TOKEN!
        }
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        log.warn(`${response.status} Profitwell sub cancellation response:`);
        log.warn(body);

        throw new AccountingError(response.status, `Unexpected ${response.status} from Profitwell`, body);
    }
}
