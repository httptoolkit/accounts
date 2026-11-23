import { SKU, PricedSKU, Interval } from '@httptoolkit/accounts';

import { AppMetadata, LifetimeUserMetadata, TrialUserMetadata } from './user-data-facade.ts';

export const ProductDetails = {
    'pro-monthly': {
        title: 'HTTP Toolkit Pro (monthly)',
        interval: 'month'
    },
    'pro-annual': {
        title: 'HTTP Toolkit Pro (annual)',
        interval: 'year'
    },
    'pro-perpetual': {
        title: 'HTTP Toolkit Pro (perpetual)',
        interval: 'perpetual'
    },
    'team-monthly': {
        title: 'HTTP Toolkit Team (monthly)',
        interval: 'month'
    },
    'team-annual': {
        title: 'HTTP Toolkit Team (annual)',
        interval: 'year'
    },
} as const;

export const SKUs = Object.keys(ProductDetails) as
    Array<keyof typeof ProductDetails>;

export const PricedSKUs = SKUs
    .filter(sku => sku !== 'pro-perpetual') as Array<PricedSKU>;

const BLACK_FRIDAY_DEAL_END = '2026-12-02T12:00:00Z';
export const BLACK_FRIDAY_DEAL_COUPON = 'BLACKFRIDAY26';

// The list price, in years of the local annual Pro price, before the coupon above:
export const BLACK_FRIDAY_DEAL_PRICE_IN_YEARS = 4;

export const getBlackFridayDealEnd = () =>
    new Date(process.env.BLACK_FRIDAY_DEAL_END || BLACK_FRIDAY_DEAL_END).getTime();

export const isBlackFridayDealActive = () =>
    Date.now() < getBlackFridayDealEnd();

export const isProSubscription = (sku: string | undefined) =>
    sku?.startsWith('pro-');

export const isTeamSubscription = (sku: string | undefined) =>
    sku?.startsWith('team-');

export const getSkuInterval = (sku: string): Interval => {
    const interval = sku.split('-')[1];
    if (interval !== 'annual' && interval !== 'monthly' && interval !== 'perpetual') {
        throw new Error(`Unrecognized interval from SKU ${sku}`);
    }

    return interval;
}

export const isLifetimeSku = (sku: string | undefined): sku is 'pro-perpetual' =>
    sku === 'pro-perpetual';

// A license bought as a single order, with no subscription behind it. Older perpetual
// accounts share the same SKU, but are very long subscriptions, so don't count here.
export const isOneOffLicense = (
    metadata: AppMetadata | undefined
): metadata is LifetimeUserMetadata =>
    !!metadata &&
    'paddle_order_id' in metadata &&
    !('subscription_id' in metadata) &&
    isLifetimeSku(metadata.subscription_sku);

export const getSku = (metadata: AppMetadata | undefined): SKU | undefined => {
    if (!metadata) return undefined;
    return (metadata as TrialUserMetadata).subscription_sku;
}