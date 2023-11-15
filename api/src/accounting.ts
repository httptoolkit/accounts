import fetch from "node-fetch";

import { SKU } from "@httptoolkit/accounts";
import { delay } from "@httptoolkit/util";

import { getPaddleIdForSku } from "./paddle";
import { getSkuInterval } from "./products";

const PROFITWELL_PRIVATE_TOKEN = process.env.PROFITWELL_PRIVATE_TOKEN;
const PROFITWELL_API_BASE_URL = process.env.PROFITWELL_API_BASE_URL
    ?? 'https://api.profitwell.com';

interface Traits {
    'Payment provider'?: string,
    'Country code'?: string
}

// Attempt to update the user to log subscription metadata (e.g. the provider used) so
// we can work out where the actual money is later on.
export async function setRevenueTraits(email: string, traits: Traits, retries = 3) {
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

        const responseBody = await response.text().catch(console.log);

        if (response.status === 400 && responseBody?.includes('Customer already has trait')) {
            // This is totally fine, if it's already set then we're happy regardless.
            return;
        } else if (!response.ok) {
            console.log(responseBody);
            throw new Error(`Failed to set Profitwell ${category}:${trait} on ${email} (${response.status})`);
        } else {
            // Trait set OK, all good.
            return;
        }
    })).catch(async (e) => {
        if (retries > 0) {
            // Retry failures, to work around intermittent connection problems or race conditions
            // where a parallel process (e.g. Paddle's Profitwell integration) or Profitwell's
            // own processing hasn't completed yet and so the customer isn't recognized.
            await delay(2000);
            return setRevenueTraits(email, traits, retries - 1);
        } else {
            throw e;
        }
    });
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
            value: subscription.price * 100,
            effective_date: Math.round(subscription.effectiveDate.getTime() / 1000)
        })
    });

    if (!response.ok) throw new Error(`Unexpected ${response.status} from Profitwell`);

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

    if (!response.ok) throw new Error(`Unexpected ${response.status} from Profitwell`);
}
