import * as _ from 'lodash';

export interface SubscriptionPlan {
    id: number;
    name: string;

    // Prices are undefined until loadPrices resolves
    prices?: {
        monthly: string;
        total: string;
    };
}

export const SubscriptionPlans = {
    'pro-monthly': { id: 550380, name: 'Pro (monthly)' } as SubscriptionPlan,
    'pro-annual': { id: 550382, name: 'Pro (annual)' } as SubscriptionPlan,
    'pro-perpetual': { id: 599788, name: 'Pro (perpetual)' } as SubscriptionPlan,
    'team-monthly': { id: 550789, name: 'Team (monthly)' } as SubscriptionPlan,
    'team-annual': { id: 550788, name: 'Team (annual)' } as SubscriptionPlan,
};

export async function loadPrices() {
    const response = await fetch(
        `https://accounts.httptoolkit.tech/api/get-prices?product_ids=${
            Object.values(SubscriptionPlans).map(plan => plan.id).join(',')
        }`
    );

    if (!response.ok) {
        console.log(response);
        throw new Error(`Failed to look up prices, got ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
        console.log(data);
        throw new Error("Price lookup request was unsuccessful");
    }

    const productPrices = data.response.products as Array<{
        product_id: number,
        currency: string,
        price: { net: number },
        subscription: { interval: string }
    }>;

    // Sanity check to ensure both arrays contain the same ids:
    if (
        _.intersection(
            productPrices.map(p => p.product_id),
            Object.values(SubscriptionPlans).map(p => p.id)
        ).length !== productPrices.length
    ) {
        throw new Error(
            `Received ${productPrices.length} prices for ${
                Object.keys(SubscriptionPlans).length
            } plans`
        );
    }

    productPrices.forEach((productPrice) => {
        const plan = _.find(SubscriptionPlans,
            { id: productPrice.product_id }
        ) as SubscriptionPlan | undefined;

        if (!plan) throw new Error(
            `Couldn't find plan ${productPrice.product_id} for price response`
        );

        const currency = productPrice.currency;
        const totalPrice = productPrice.price.net;
        const monthlyPrice = productPrice.subscription.interval === 'year'
            ? totalPrice / 12
            : totalPrice;

        plan.prices = {
            total: formatPrice(currency, totalPrice),
            monthly: formatPrice(currency, monthlyPrice)
        };
    });
}

function formatPrice(currency: string, price: number) {
    return Number(price).toLocaleString(undefined, {
        style:"currency",
        currency: currency,
        minimumFractionDigits: _.round(price) === price ? 0 : 2,
        maximumFractionDigits: 2
    })
}

export type SubscriptionPlanCode = keyof typeof SubscriptionPlans;

export const getSubscriptionPlanCode = (id: number | undefined) =>
    _.findKey(SubscriptionPlans, { id: id }) as SubscriptionPlanCode | undefined;