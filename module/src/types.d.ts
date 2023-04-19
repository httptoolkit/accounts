import type { SubscriptionPlans } from "./plans";

// Valid subscription state values:
export type SubscriptionPlanCode = keyof typeof SubscriptionPlans;
export type SubscriptionStatus =
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'deleted';

export type SKU =
    | 'pro-monthly'
    | 'pro-annual'
    | 'pro-perpetual'
    | 'team-monthly'
    | 'team-annual';

export type Interval =
    | 'monthly'
    | 'annual'
    | 'perpetual';

// We only support pro-perpetual for special cases - it's not priced
// or shown on pricing/checkout pages:
export type PricedSKU = Exclude<SKU, 'pro-perpetual'>;

export type SubscriptionPricing = {
    product_id: number; // Paddle-specific id
    sku: SKU;
    product_title: string;
    currency: string; // EUR/USD/etc
    price: {
        net: number // Net price to 2dp in local currency
    },
    subscription: {
        interval: 'month' | 'year'
    }
}

// User app data, as returned by the API
export type UserAppData = {
    email: string;
    feature_flags?: string[];
    banned?: boolean;

    // If you're the owner of a team, you'll have team subscription data.
    // This data defines the team's subscription, but doesn't affect you
    // (i.e. you're not necessarily a member of the team)
    team_subscription?: SubscriptionData;
} & SubscriptionData; // <-- Real sub data lives on the root


// User billing data, as returned by the API
export type UserBillingData = {
    email: string;
    transactions: TransactionData[];

    // Team members only:
    team_owner?: {
        id: string;
        name?: string;
        error?: string;
    };

    // Team owner only - undefined for Pro.
    team_members?: Array<{
        id: string;
        name: string;
        locked: boolean; // If this user is removed, is the license blocked from reassignment?
        error?: string;
    }>;
    locked_license_expiries?: number[]; // Array of lock expiry timestamps
} & SubscriptionData; // <-- Real sub data lives on the root

// Subscription data as returned by the API
export interface SubscriptionData {
    subscription_status?: SubscriptionStatus;
    subscription_sku?: SKU;
    subscription_expiry?: number;
    update_url?: string;
    cancel_url?: string;
    last_receipt_url?: string;

    /**
     * Deprecated in favour of sub_sku. We can't remove this for a while, as old UIs (pre-3/2023)
     * will not understand subs without it, and will treat them as no subscription at all.
     * @deprecated
     **/
    subscription_plan_id?: number;

    // Team subs only:
    subscription_quantity?: number;
    team_member_ids?: string[];

    // Team members only:
    subscription_owner_id?: string;

    // Team owners and Pro users can manage the subscription (cancel, update billing details, etc).
    // Team members can see basic details, but can't manage them.
    can_manage_subscription?: boolean;
}

export interface TransactionData {
    order_id: string;
    receipt_url: string;
    product_id: number;
    created_at: string;
    status: string;

    currency: string;
    amount: string;
}

// User model in JS
export type User = {
    email?: string;
    subscription?: Subscription;
    featureFlags: string[];
};

// Subscription data model in JS
export type Subscription = {
    id: number;
    status: SubscriptionStatus;
    plan: SubscriptionPlanCode;
    expiry: Date;
    updateBillingDetailsUrl?: string;
    cancelSubscriptionUrl?: string;
    lastReceiptUrl?: string;
};