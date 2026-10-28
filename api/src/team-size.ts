import { StatusError } from './errors.ts';
import { getSku, isTeamSubscription } from './products.ts';
import { PaddleSubscription, updateSubscriptionQuantity } from './paddle.ts';
import type { TeamOwnerMetadata } from './user-data-facade.ts';

/**
 * An upper bound on self-service changes, to avoid enormous accidental/automated charges.
 * Accounts above this can be upgraded manually.
 */
export const MAX_TEAM_SIZE = 100;

// The smallest quantity a team can drop to without unlicensing a current member. Locked
// licenses don't count - they only block reassignment, not paying for fewer.
export function getMinTeamSize(ownerData: TeamOwnerMetadata) {
    return Math.max(1, (ownerData.team_member_ids ?? []).length);
}

// Rejects any subscription whose size we can't change, returning its SKU otherwise:
export function assertUpdatableTeamSubscription(ownerData: TeamOwnerMetadata) {
    const sku = getSku(ownerData);
    if (!isTeamSubscription(sku)) {
        throw new StatusError(403, "Your account does not have a Team subscription");
    } else if (ownerData.subscription_status !== 'active' || ownerData.subscription_expiry < Date.now()) {
        throw new StatusError(403, "Your account does not have an active subscription");
    } else if (ownerData.payment_provider === 'manual' || ownerData.payment_provider === 'student-account') {
        throw new StatusError(400, "Cannot update manually managed subscription. Please contact billing@httptoolkit.com");
    } else if (ownerData.payment_provider !== 'paddle') {
        throw new StatusError(500, "Cannot automatically update non-Paddle team subscription. Please contact billing@httptoolkit.com");
    } else if (ownerData.subscription_coupon) {
        throw new StatusError(400,
            "Can't automatically update accounts with an active discount. Please contact billing@httptoolkit.com"
        );
    } else if (
        !Number.isInteger(ownerData.subscription_quantity) ||
        ownerData.subscription_quantity < 1
    ) {
        // Used to tell upgrades (billed now) from downgrades (deferred), so it's required:
        throw new StatusError(500, "Subscription has no valid license count");
    }

    return sku!;
}

// Paddle's quantity is what the next renewal will bill, which may be lower than the quantity
// paid for this period, if a reduction is pending.
export function getRenewalQuantity(subscription: PaddleSubscription | undefined) {
    const quantity = subscription?.quantity;
    if (quantity === undefined || !Number.isInteger(quantity) || quantity < 1) {
        throw new StatusError(502, "Could not load your subscription from the payment provider");
    }
    return quantity;
}

export interface TeamSizeChangePlan {
    paidQuantity: number;
    renewalQuantity: number;
    newTeamSize: number;
    isUpgrade: boolean;
    paddleUpdates: Array<{ quantity: number, prorate: boolean, billImmediately: boolean }>;
}

export function planTeamSizeChange(
    ownerData: TeamOwnerMetadata,
    renewalQuantity: number,
    newTeamSize: number
): TeamSizeChangePlan {
    const paidQuantity = ownerData.subscription_quantity;

    if (renewalQuantity > paidQuantity) {
        // This window is brief - only until the webhook is delivered (or retried successfully)
        throw new StatusError(409, "Your subscription is being updated, please try again shortly");
    } else if (!Number.isInteger(newTeamSize)) {
        throw new StatusError(400, `Subscription quantity must be a whole number (was ${newTeamSize})`);
    } else if (newTeamSize < 1) {
        throw new StatusError(400, "Cannot reduce subscription below 1 license");
    } else if (newTeamSize > MAX_TEAM_SIZE) {
        throw new StatusError(400,
            `Cannot expand subscription beyond ${MAX_TEAM_SIZE} licenses. Please contact billing@httptoolkit.com`
        );
    } else if (newTeamSize === renewalQuantity) {
        throw new StatusError(400, "Cannot update subscription to the same number of licenses");
    } else if (newTeamSize < getMinTeamSize(ownerData)) {
        throw new StatusError(409, "Cannot downgrade subscription below the number of assigned licenses");
    }

    const isUpgrade = newTeamSize > paidQuantity;

    return {
        paidQuantity,
        renewalQuantity,
        newTeamSize,
        isUpgrade,
        paddleUpdates: [
            // Paddle does pro-ration against its stored quantity, so if there's a pending downgrade
            // we reset it before applying an upgrade (if this ever comes up)
            ...(isUpgrade && renewalQuantity < paidQuantity
                ? [{ quantity: paidQuantity, prorate: false, billImmediately: false }]
                : []
            ),
            // Apply the change. Defer billing for downgrades to next renewal.
            { quantity: newTeamSize, prorate: isUpgrade, billImmediately: isUpgrade }
        ]
    };
}

export async function applyTeamSizeChange(
    subscriptionId: string | number,
    plan: TeamSizeChangePlan
) {
    // Sequential, as a reset must land before the upgrade that's pro-rated against it:
    for (const { quantity, ...options } of plan.paddleUpdates) {
        await updateSubscriptionQuantity(subscriptionId, quantity, options);
    }
}
