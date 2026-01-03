import { SKU, PricedSKU, Interval } from "@httptoolkit/accounts";

import { AppMetadata, TrialUserMetadata } from "./user-data-facade";
import { getSkuForPaddleId } from "./paddle";

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

export const getSku = (metadata: AppMetadata | undefined): SKU | undefined => {
    if (!metadata) return undefined;
    const subMetadata = metadata as TrialUserMetadata;
    return subMetadata.subscription_sku
        ?? getSkuForPaddleId(subMetadata.subscription_plan_id);
}