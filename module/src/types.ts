import type { SubscriptionPlans } from "./plans";

export type SKU = keyof typeof SubscriptionPlans;

// We only support pro-perpetual for special cases - it's not priced
// or shown on pricing/checkout pages:
export type PricedSKU = Exclude<SKU, 'pro-perpetual'>;

// Valid subscription state values:
export type SubscriptionStatus =
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'deleted';

export type TierCode = 'pro' | 'team';

export type Interval =
    | 'monthly'
    | 'annual'
    | 'perpetual';

// Subscription plan pricing, as returned by the API
export interface SubscriptionPricing {
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
    user_id: string;
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
    user_id: string;
    email: string;
    banned?: boolean;
    transactions: TransactionData[] | null;

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
    // This isn't a security mechanism - it's more like an indicative check for UX to decide
    // whether cancel/update buttons should show. Real check happens in API endpoints.
    can_manage_subscription?: boolean;

    // Only true for team subscriptions where the payment provider supports
    // self-service team size updates (currently Paddle only).
    can_update_team_size?: boolean;
}

// Team size quote data, as returned by the API for team owners who can
// self-serve their own license count changes.
export interface TeamSizeQuoteData {
    currency: string;
    unit_price: number; // Tax-inclusive cost of one license for a full billing period

    current_quantity: number;
    renewal_quantity: number; // Lower than current while a reduction is pending
    min_quantity: number; // Lowest size that keeps every current member licensed
    max_quantity: number; // Highest size that can be set without contacting support

    interval: Interval;
    next_bill_date: string; // YYYY-MM-DD
    days_in_period: number;
    days_remaining: number;
}

// The same data, parsed for use by callers:
export interface TeamSizeQuote {
    currency: string;
    /**
     * What one license costs for a whole billing period, including tax. Read from the
     * subscription itself, so this reflects any price specific to this customer.
     */
    unitPrice: number;

    currentQuantity: number;
    renewalQuantity: number; // Lower than current while a reduction is pending
    // The lowest size available without unlicensing a current team member:
    minQuantity: number;
    maxQuantity: number;

    interval: Interval;
    nextBillDate: string; // YYYY-MM-DD
    daysInPeriod: number;
    daysRemaining: number;
}

// Transaction data, as returned within API billing responses
export interface TransactionData {
    order_id: string; // Used as key
    receipt_url: string; // url
    sku: SKU; // Used to show plan name for this order
    created_at: string; // Used for date, ISO format UTC
    status:
        | 'completed'
        | 'refunded'
        | 'partially_refunded'
        | 'disputed'
        | 'waiting'
        | 'canceled';

    currency: string; // Shown together as total paid
    amount: string;
}