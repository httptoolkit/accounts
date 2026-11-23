import moment from 'moment';
import log from 'loglevel';

import {
    AppMetadata,
    LifetimeUserMetadata,
    PayingUserMetadata,
    getOrCreateUser,
    updateUserMetadata
} from './user-data-facade.ts';
import { getSku, isOneOffLicense, isTeamSubscription } from './products.ts';
import { formatErrorMessage, reportError, StatusError } from './errors.ts';
import * as Paddle from './paddle.ts';
import * as PayPro from './paypro.ts';

// Every client expects all paid accounts to have an expiry date, so lifetime licenses do
// expire, but only long after anybody will care.
const LIFETIME_LICENSE_YEARS = 100;

// The license itself, plus everything left behind by a previous subscription:
type LifetimeLicenseUpdate = LifetimeUserMetadata
    & Pick<PayingUserMetadata,
        | 'subscription_id'
        | 'paddle_user_id'
        | 'subscription_coupon'
        | 'update_url'
        | 'cancel_url'
    >;

export async function grantLifetimeLicense(email: string, order: {
    orderId: string,
    receiptUrl: string,
    purchasedAt: number
}) {
    const user = await getOrCreateUser(email);
    const existingData: AppMetadata = user.app_metadata ?? {};

    if (isOneOffLicense(existingData) && existingData.subscription_status === 'active') {
        if (existingData.paddle_order_id === order.orderId) return; // Repeated notification

        // The latest order becomes the license, and the other needs refunding by hand:
        reportError(`Repeated lifetime license purchase for ${email}`, {
            extraMetadata: { existing: existingData, order }
        });
    }

    // Team accounts are never changed automatically, whatever state the team is in. Failing
    // here reports the order, so it can be resolved (and probably refunded) by hand.
    if (isTeamSubscription(getSku(existingData))) {
        throw new StatusError(409, `Cannot activate lifetime order ${order.orderId} for team owner ${email}`);
    }
    if ('subscription_owner_id' in existingData) {
        throw new StatusError(409, `Cannot activate lifetime order ${order.orderId} for team member ${email}`);
    }

    await updateUserMetadata<LifetimeLicenseUpdate>(user.user_id, {
        subscription_status: 'active',
        subscription_sku: 'pro-perpetual',
        subscription_quantity: 1,
        subscription_expiry: moment(order.purchasedAt).add(LIFETIME_LICENSE_YEARS, 'years').valueOf(),
        payment_provider: 'paddle',
        paddle_order_id: order.orderId,
        last_receipt_url: order.receiptUrl,

        subscription_id: null,
        paddle_user_id: null,
        subscription_coupon: null,
        update_url: null,
        cancel_url: null
    });

    await cancelReplacedSubscription(email, existingData);
}

// A subscription that carried on after a lifetime purchase would keep charging for nothing.
async function cancelReplacedSubscription(email: string, existingData: AppMetadata) {
    if (!('subscription_id' in existingData) || !existingData.subscription_id) return;
    if (existingData.subscription_status === 'deleted') return;

    const { payment_provider: provider, subscription_id: subscriptionId } = existingData;

    try {
        if (!provider || provider === 'paddle') {
            await Paddle.cancelSubscription(subscriptionId);
        } else if (provider === 'paypro') {
            await PayPro.cancelSubscription(subscriptionId);
        } else {
            return; // Nothing is billing for manual or student accounts
        }

        log.info(`Cancelled subscription ${subscriptionId} for ${email}, replaced by a lifetime license`);
    } catch (e) {
        reportError(`Failed to cancel subscription ${subscriptionId} for ${
            email
        } after a lifetime license purchase: ${formatErrorMessage(e)}`);
    }
}
