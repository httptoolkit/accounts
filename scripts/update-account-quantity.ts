#!./node_modules/.bin/tsx

import prompts from 'prompts';

import { getUsersByEmail, PayingUserMetadata, updateUserMetadata } from '../api/src/user-data-facade';
import { closeDatabase, initializeDbConnection } from '../api/src/db/database';
import * as paddle from '../api/src/paddle';
import * as paypro from '../api/src/paypro';

const email = process.argv[2];
const subQuantity = +process.argv[3];
const upgradeChargeSet = process.argv[4] !== undefined;
const upgradeCharge = +process.argv[4];

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
    const metadata = user.app_metadata as PayingUserMetadata;

    if (
        metadata?.subscription_status !== 'active' ||
        metadata?.subscription_expiry < Date.now()
    ) {
        throw new Error(`User has no active subscription. Data is: ${metadata}`);
    }

    if (!['team-monthly', 'team-annual'].includes(metadata.subscription_sku)) {
        throw new Error(`User has plan ${metadata.subscription_sku} which is not a Team subscription`);
    }

    if (metadata.payment_provider !== 'paddle' && metadata.payment_provider !== 'paypro') {
        throw new Error(`User has payment provider ${metadata.payment_provider} which is not supported for automatic quantity updates`);
    }

    if (metadata.payment_provider !== 'paypro' && upgradeChargeSet) {
        throw new Error(`Upgrade charge option is only supported for PayPro subscriptions`);
    } else if (metadata.payment_provider === 'paypro' && (!upgradeChargeSet || isNaN(upgradeCharge))) {
        throw new Error(`Upgrade charge must be provided for PayPro subscriptions`);
    }

    const subscriptionId = metadata.subscription_id;
    const existingQuantity = metadata.subscription_quantity;

    const { result } = await prompts({
        name: 'result',
        type: 'confirm',
        message: `Update subscription ${
            metadata.payment_provider === 'paddle'
            ? `https://vendors.paddle.com/subscriptions/customers/manage/${subscriptionId}`
            : `https://cc.payproglobal.com/Subscriptions/Details/${subscriptionId}`
        } from ${
            existingQuantity
        } to ${
            subQuantity
        }?`
    });

    if (!result) {
        console.log("Cancelled");
        process.exit(1);
    }

    const isUpgrade = subQuantity > existingQuantity;

    if (metadata.payment_provider === 'paddle') {
        await paddle.updateSubscriptionQuantity(subscriptionId, subQuantity, {
            billImmediately: isUpgrade,
            prorate: isUpgrade
        });
    } else if (metadata.payment_provider === 'paypro') {
        // TODO: PayPro is very WIP here - can't charge immediately or pro-rate, doesn't
        // update anything manually, use with great care.
        await paypro.updateSubscriptionQuantity(subscriptionId, subQuantity);

        // This is not automatically updated by PayPro - no webhooks fire until the next bill:
        await updateUserMetadata(user.user_id!, {
            subscription_quantity: subQuantity
        });

        if (upgradeCharge !== 0) {
            throw new Error(`PayPro upgrade charge not yet supported and must be handled manually`);
        }
    }

    await closeDatabase(db);
})();