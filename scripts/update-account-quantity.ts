#!./node_modules/.bin/tsx

import prompts from 'prompts';

import {
    getUsersByEmail,
    PayingUserMetadata,
    TeamOwnerMetadata,
    updateUserMetadata
} from '../api/src/user-data-facade';
import { closeDatabase, initializeDbConnection } from '../api/src/db/database';
import * as paddle from '../api/src/paddle';
import * as paypro from '../api/src/paypro';
import { getSkuInterval } from '../api/src/products';
import { getBillingPeriod } from '../api/src/proration';
import {
    assertUpdatableTeamSubscription,
    getRenewalQuantity,
    planTeamSizeChange,
    TeamSizeChangePlan
} from '../api/src/team-size';
import { applyTeamSizeChange } from '../api/src/team-size-updates';

const email = process.argv[2];
const subQuantity = +process.argv[3];
const upgradeChargeSet = process.argv[4] !== undefined;
const upgradeCharge = +process.argv[4];

const confirm = async (message: string) => {
    const { result } = await prompts({ name: 'result', type: 'confirm', message });
    if (!result) {
        console.log("Cancelled");
        process.exit(1);
    }
};

// Best-effort, since this is only informational and shouldn't block support changes:
const estimateUpgradeCharge = (
    subscription: paddle.PaddleSubscription | undefined,
    metadata: TeamOwnerMetadata,
    plan: TeamSizeChangePlan
) => {
    if (!plan.isUpgrade || !subscription) return 'nothing';

    try {
        const pricing = paddle.getSubscriptionPricing(subscription);
        const period = getBillingPeriod(pricing.nextBillDate, getSkuInterval(metadata.subscription_sku));
        const charge = pricing.unitPrice * (plan.newTeamSize - plan.paidQuantity) *
            (period.daysRemaining / period.daysInPeriod);

        return `about ${charge.toFixed(2)} ${pricing.currency} (incl. tax, ${
            period.daysRemaining
        }/${period.daysInPeriod} days remaining)`;
    } catch (e) {
        return `unknown (${e})`;
    }
};

async function updatePaddleQuantity(userId: string, metadata: TeamOwnerMetadata) {
    if (upgradeChargeSet) {
        throw new Error(`Upgrade charge option is only supported for PayPro subscriptions`);
    }

    assertUpdatableTeamSubscription(metadata);

    const subscription = await paddle.getPaddleSubscription(metadata.subscription_id);
    const plan = planTeamSizeChange(metadata, getRenewalQuantity(subscription), subQuantity);

    await confirm([
        `Update subscription https://vendors.paddle.com/subscriptions/customers/manage/${
            metadata.subscription_id
        }`,
        `Paid for now: ${plan.paidQuantity}, at renewal: ${plan.renewalQuantity}, new: ${plan.newTeamSize}`,
        `Paddle updates: ${plan.paddleUpdates.map(({ quantity, prorate }) =>
            `${quantity} (${prorate ? 'pro-rated, billed now' : 'not billed now'})`
        ).join(', then ')}`,
        `Charged today: ${estimateUpgradeCharge(subscription, metadata, plan)}`,
        'Continue?'
    ].join('\n'));

    await applyTeamSizeChange(userId, metadata.subscription_id, plan);
}

async function updatePayProQuantity(userId: string, metadata: PayingUserMetadata) {
    if (
        metadata.subscription_status !== 'active' ||
        metadata.subscription_expiry < Date.now()
    ) {
        throw new Error(`User has no active subscription. Data is: ${metadata}`);
    }

    if (!['team-monthly', 'team-annual'].includes(metadata.subscription_sku)) {
        throw new Error(`User has plan ${metadata.subscription_sku} which is not a Team subscription`);
    }

    if (!upgradeChargeSet || isNaN(upgradeCharge)) {
        throw new Error(`Upgrade charge must be provided for PayPro subscriptions`);
    }

    const subscriptionId = metadata.subscription_id;

    await confirm(`Update subscription https://cc.payproglobal.com/Subscriptions/Details/${
        subscriptionId
    } from ${metadata.subscription_quantity} to ${subQuantity}?`);

    // TODO: PayPro is very WIP here - can't charge immediately or pro-rate, doesn't
    // update anything manually, use with great care.
    await paypro.updateSubscriptionQuantity(subscriptionId, subQuantity);

    // This is not automatically updated by PayPro - no webhooks fire until the next bill:
    await updateUserMetadata(userId, {
        subscription_quantity: subQuantity
    });

    if (upgradeCharge !== 0) {
        throw new Error(`PayPro upgrade charge not yet supported and must be handled manually`);
    }
}

(async () => {
    const db = await initializeDbConnection();

    if (isNaN(subQuantity)) {
        throw new Error(`Quantity must be a number, was ${subQuantity}`);
    }

    const users = await getUsersByEmail(email);

    if (users.length !== 1) {
        throw new Error(`Can't update, found ${users.length} users for email ${email}`);
    }

    const user = users[0];
    const metadata = user.app_metadata as TeamOwnerMetadata;

    if (metadata.payment_provider === 'paypro') {
        await updatePayProQuantity(user.user_id, metadata);
    } else {
        await updatePaddleQuantity(user.user_id, metadata);
    }

    await closeDatabase(db);
})();
