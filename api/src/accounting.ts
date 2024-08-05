import fetch from "node-fetch";
import * as log from 'loglevel';

import { SKU } from "@httptoolkit/accounts";
import { CustomError, delay } from "@httptoolkit/util";

import { getPaddleIdForSku } from "./paddle";
import { getSkuInterval } from "./products";
import { reportError } from "./errors";

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
        public readonly body: string
    ) {
        super(message, { statusCode });
    }
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
            // an unavoidable limitation of Profitwell, so we report but consider as OK for now.
            reportError(`Unable to log ${trait}=${category} for ${email} due to trait limit`);
            return;
        } else if (!response.ok) {
            log.warn(`${response.status} Profitwell traits response: ${responseBody}`);
            throw new Error(`Failed to set Profitwell ${category}:${trait} on ${email} (${response.status})`);
        } else {
            // Trait set OK, all good.
            return;
        }
    })).catch(async (e) => {
        // Retry failures, to work around intermittent connection problems or race conditions
        // where a parallel process (e.g. Paddle's Profitwell integration) or Profitwell's
        // own processing hasn't completed yet and so the customer isn't recognized.
        if (retries > 0) {
            // Exponentially increasing retries (maximum ~24 hours total)
            const sleepTime = 1000 * (3 ** (DEFAULT_PROFITWELL_RETRIES - retries));

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
    const response = await fetch(`${PROFITWELL_API_BASE_URL}/v2/subscriptions/`, {
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
        throw new AccountingError(response.status, `Unexpected ${response.status} from Profitwell`, body);
    }

    await setRevenueTraits(email, traits);
}

export async function recordCancellation(
    subscriptionId: string,
    effectiveDate: number
) {
    // Record the subscription cancellation in Profitwell:
    const response = await fetch(`${PROFITWELL_API_BASE_URL}/v2/subscriptions/${
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
