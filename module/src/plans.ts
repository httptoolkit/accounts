import * as _ from 'lodash';
import { delay, doWhile } from '@httptoolkit/util';
import { SKU, SubscriptionPricing } from './types';

import { ACCOUNTS_API_BASE } from './util';

export interface SubscriptionPlan {
    paddleId: number;
    name: string;
    prices?: {
        rawTotal: number;
        currency: string;
        monthly: string;
        total: string;
    } | 'priceless';
}

export const SubscriptionPlans = {
    'pro-monthly': { paddleId: 550380, name: 'Pro (monthly)' } as SubscriptionPlan,
    'pro-annual': { paddleId: 550382, name: 'Pro (annual)' } as SubscriptionPlan,
    'team-monthly': { paddleId: 550789, name: 'Team (monthly)' } as SubscriptionPlan,
    'team-annual': { paddleId: 550788, name: 'Team (annual)' } as SubscriptionPlan,
    // Defunct, but kept to support existing accounts:
    'pro-perpetual': { paddleId: 599788, name: 'Pro (perpetual)', prices: 'priceless' } as SubscriptionPlan
};

export type SubscriptionPlans = typeof SubscriptionPlans;

async function loadPlanPrices() {
    const response = await fetch(`${ACCOUNTS_API_BASE}/get-prices`);

    if (!response.ok) {
        console.log(response);
        throw new Error(`Failed to look up prices, got ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
        console.log(data);
        throw new Error("Price lookup request was unsuccessful");
    }

    const productPrices = data.response.products as Array<SubscriptionPricing>;

    productPrices.forEach((productPrice) => {
        const plan = _.find(SubscriptionPlans,
            { paddleId: productPrice.product_id }
        ) as SubscriptionPlan | undefined;

        if (!plan) return;

        const currency = productPrice.currency;
        const totalPrice = productPrice.price.net;
        const monthlyPrice = productPrice.subscription.interval === 'year'
            ? totalPrice / 12
            : totalPrice;

        plan.prices = {
            rawTotal: totalPrice,
            currency: currency,
            total: formatPrice(currency, totalPrice),
            monthly: formatPrice(currency, monthlyPrice)
        };
    });

    return SubscriptionPlans;
}

export async function loadPlanPricesUntilSuccess() {
    // Async load all plan prices, repeatedly, until it works
    await doWhile(
        // Do: load the prices, with a timeout
        () => Promise.race([
            loadPlanPrices().catch(console.warn),
            delay(5000) // 5s timeout
        ]).then(() => delay(1000)), // Limit the frequency

        // While: if any subs didn't successfully get data, try again:
        () => _.some(SubscriptionPlans, (plan) => !plan.prices),
    );

    return SubscriptionPlans;
}

function formatPrice(currency: string, price: number) {
    return Number(price).toLocaleString(undefined, {
        style: "currency",
        currency: currency,
        minimumFractionDigits: _.round(price) === price ? 0 : 2,
        maximumFractionDigits: 2
    })
}

export const getPlanByCode = (sku: SKU) => SubscriptionPlans[sku];

export const getSKUForPaddleId = (paddleId: number | undefined) =>
    _.findKey(SubscriptionPlans, { paddleId: paddleId }) as SKU | undefined;
