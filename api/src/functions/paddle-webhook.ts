import { initSentry, catchErrors } from '../errors';
initSentry();

import _ from 'lodash';
import moment from 'moment';
import * as querystring from 'querystring';

import {
    AppMetadata,
    LICENSE_LOCK_DURATION_MS,
    mgmtClient,
    PayingUserMetadata,
    TeamOwnerMetadata,
    User
} from '../auth0';
import {
    validateWebhook,
    WebhookData,
    getSkuForPaddleId
} from '../paddle';
import {
    getSku,
    isProSubscription,
    isTeamSubscription
} from '../products';

async function getOrCreateUserData(email: string): Promise<User> {
    const users = await mgmtClient.getUsersByEmail(email);
    if (users.length > 1) {
        throw new Error(`More than one user found for ${email}`);
    } else if (users.length === 1) {
        return users[0];
    } else {
        // Create the user, if they don't already exist:
        return mgmtClient.createUser({
            email,
            connection: 'email',
            email_verified: true, // This ensures users don't receive an email code or verification
            app_metadata: {}
        });
    }
}

function dropUndefinedValues(obj: { [key: string]: any }) {
    Object.keys(obj).forEach((key: any) => {
        if (obj[key] === undefined) delete obj[key];
    });
}

async function updateProUserData(email: string, subscription: Partial<PayingUserMetadata>) {
    const user = await getOrCreateUserData(email);

    dropUndefinedValues(subscription);

    if (!_.isEmpty(subscription)) {
        await mgmtClient.updateAppMetadata({ id: user.user_id! }, subscription);
    }
}

async function banUser(email: string) {
    const user = await getOrCreateUserData(email);
    await mgmtClient.updateAppMetadata({ id: user.user_id! }, { banned: true });
}

function getSubscriptionFromHookData(hookData: WebhookData): Partial<PayingUserMetadata> {
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
            paddle_user_id: parseInt(hookData.user_id, 10),
            subscription_id: parseInt(hookData.subscription_id, 10),
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
            paddle_user_id: parseInt(hookData.user_id, 10),
            subscription_id: parseInt(hookData.subscription_id, 10),
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
            paddle_user_id: parseInt(hookData.user_id, 10),
            subscription_id: parseInt(hookData.subscription_id, 10),
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
            paddle_user_id: parseInt(hookData.user_id, 10),
            subscription_id: parseInt(hookData.subscription_id, 10),
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

async function updateTeamData(email: string, subscription: Partial<PayingUserMetadata>) {
    const currentUserData = await getOrCreateUserData(email);
    const currentMetadata = (currentUserData.app_metadata ?? {}) as AppMetadata;
    const newMetadata: Partial<TeamOwnerMetadata> = subscription;

    if (!('team_member_ids' in currentMetadata)) {
        // If the user is not currently a team owner: give them an empty team
        newMetadata.team_member_ids = [];
    }

    // Cleanup locked licenses: drop all locks that expired in the past
    newMetadata.locked_licenses = ((currentMetadata as TeamOwnerMetadata).locked_licenses ?? [])
        .filter((lockStartTime) =>
            lockStartTime + LICENSE_LOCK_DURATION_MS > Date.now()
        )

    dropUndefinedValues(newMetadata);

    if (!_.isEmpty(newMetadata)) {
        await mgmtClient.updateAppMetadata({ id: currentUserData.user_id! }, newMetadata);
    }
}

export const handler = catchErrors(async (event) => {
    const paddleData = querystring.parse(event.body || '') as unknown as WebhookData;
    console.log('Received Paddle webhook', JSON.stringify(paddleData));

    validateWebhook(paddleData);

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

    // All done
    return { statusCode: 200, body: '' };
});