import { initSentry, catchErrors } from '../errors';
initSentry();

import _ from 'lodash';
import moment from 'moment';
import * as querystring from 'querystring';

import {
    PayingUserMetadata
} from '../auth0';
import {
    validatePaddleWebhook,
    PaddleWebhookData,
    getSkuForPaddleId
} from '../paddle';
import {
    getSku,
    isProSubscription,
    isTeamSubscription
} from '../products';
import {
    banUser,
    reportSuccessfulCheckout,
    updateProUserData,
    updateTeamData
} from '../webhook-handling';

function getSubscriptionFromHookData(hookData: PaddleWebhookData): Partial<PayingUserMetadata> {
    if (
        hookData.alert_name === 'subscription_created' ||
        hookData.alert_name === 'subscription_updated'
    ) {
        // New subscription: get & store the full data for this user

        // 1 day of slack for ongoing renewals (we don't know what time they renew).
        const endDate = moment(hookData.next_bill_date).add(1, 'day').valueOf();
        const quantity = 'quantity' in hookData
            ? hookData.quantity
            : hookData.new_quantity;

        const planId = parseInt(hookData.subscription_plan_id, 10);

        return {
            subscription_status: hookData.status,
            payment_provider: 'paddle',
            paddle_user_id: hookData.user_id,
            subscription_id: hookData.subscription_id,
            subscription_sku: getSkuForPaddleId(planId),
            subscription_plan_id: planId,
            subscription_quantity: parseInt(quantity, 10),
            subscription_expiry: endDate,
            update_url: hookData.update_url,
            cancel_url: hookData.cancel_url
        };
    } else if (hookData.alert_name === 'subscription_cancelled') {
        // Cancelled subscription - we'll never hear about this sub again. Mark is
        // as finished, and save the current end date so we know when it really stops.

        // Cancelled subscriptions end of the last day of the current plan
        const endDate = moment(hookData.cancellation_effective_date).valueOf();

        const planId = parseInt(hookData.subscription_plan_id, 10);

        return {
            subscription_status: 'deleted',
            payment_provider: 'paddle',
            paddle_user_id: hookData.user_id,
            subscription_id: hookData.subscription_id,
            subscription_sku: getSkuForPaddleId(planId),
            subscription_plan_id: planId,
            subscription_expiry: endDate,
            update_url: hookData.update_url,
            cancel_url: hookData.cancel_url
        };
    } else if (hookData.alert_name === 'subscription_payment_succeeded') {
        // Subscription has renewed (or started for the first time), update the expiry date.

        // 1 day of slack for ongoing renewals (we don't know what time they renew).
        const endDate = moment(hookData.next_bill_date).add(1, 'day').valueOf();

        const planId = parseInt(hookData.subscription_plan_id, 10);

        return {
            subscription_status: hookData.status,
            payment_provider: 'paddle',
            paddle_user_id: hookData.user_id,
            subscription_id: hookData.subscription_id,
            subscription_sku: getSkuForPaddleId(planId),
            subscription_plan_id: planId,
            subscription_expiry: endDate,
            subscription_quantity: parseInt(hookData.quantity, 10),
            last_receipt_url: hookData.receipt_url,
            update_url: hookData.update_url,
            cancel_url: hookData.cancel_url
        };
    } else if (hookData.alert_name === 'subscription_payment_failed') {
        // We wait briefly, then try to charge again, a couple of times. If the
        // final charge fails, their subscription will be cancelled automatically.
        const endDate = hookData.next_retry_date
            ? moment(hookData.next_retry_date).add(1, 'day').valueOf()
            : undefined;

        const planId = parseInt(hookData.subscription_plan_id, 10);

        return {
            subscription_status: hookData.next_retry_date ? 'past_due' : 'deleted',
            payment_provider: 'paddle',
            paddle_user_id: hookData.user_id,
            subscription_id: hookData.subscription_id,
            subscription_sku: getSkuForPaddleId(planId),
            subscription_plan_id: planId,
            subscription_expiry: endDate,
            update_url: hookData.update_url,
            cancel_url: hookData.cancel_url,
        };
    }

    // Should never happen - we effectively return 'update nothing'
    return {};
}

export const handler = catchErrors(async (event) => {
    const paddleData = querystring.parse(event.body || '') as unknown as PaddleWebhookData;
    console.log('Received Paddle webhook', JSON.stringify(paddleData));

    validatePaddleWebhook(paddleData);

    if ([
        'subscription_created',
        'subscription_updated',
        'subscription_cancelled',
        'subscription_payment_succeeded',
        'subscription_payment_failed'
    ].includes(paddleData.alert_name)) {
        // Paddle uses casing in emails, whilst it seems that auth0 does not:
        // https://community.auth0.com/t/creating-a-user-converts-email-to-lowercase/6678/4
        const email = paddleData.email.toLowerCase();

        const userData = getSubscriptionFromHookData(paddleData);
        const sku = getSku(userData);

        if (isTeamSubscription(sku)) {
            console.log(`Updating team user ${email}`);
            await updateTeamData(email, userData);
        } else if (isProSubscription(sku)) {
            console.log(`Updating Pro user ${email} to ${JSON.stringify(userData)}`);
            await updateProUserData(email, userData);
        } else {
            throw new Error(`Webhook received for unknown subscription type: ${
                userData.subscription_sku
            }/${
                userData.subscription_plan_id
            }`);
        }
    } else if (paddleData.alert_name === 'payment_dispute_created') {
        // If we receive a payment dispute, that means either the user has stolen somebody else's credit card,
        // and the transaction has been reported, or they've disputed their own valid payment for HTTP Toolkit
        // to avoid paying for it (and cause us major existential problems in return).
        // In either case, this is abusive behaviour, and we ban them from the app. This results in an alert
        // at startup, telling them to contact support and then insta-closing the app.
        const email = paddleData.email.toLowerCase();
        await banUser(email);
    } else {
        console.log(`Ignoring ${paddleData.alert_name} event`);
    }

    // Add successful checkouts to our metrics:
    if (paddleData.alert_name === 'subscription_created') {
        await reportSuccessfulCheckout(paddleData.passthrough);
    }

    // All done
    return { statusCode: 200, body: '' };
});