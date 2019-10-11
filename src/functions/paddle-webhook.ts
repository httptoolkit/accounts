import { initSentry, catchErrors } from '../errors';
initSentry();

import moment from 'moment';
import * as querystring from 'querystring';
import { APIGatewayProxyEvent } from 'aws-lambda';

import { mgmtClient } from '../auth0';
import { validateWebhook, WebhookData, SubscriptionStatus } from '../paddle';

interface SubscriptionData {
    subscription_status?: SubscriptionStatus,
    subscription_id?: number,
    subscription_plan_id?: number,
    subscription_expiry?: number,
    last_receipt_url?: string,
    update_url?: string,
    cancel_url?: string
}

async function saveUserData(email: string, subscription: SubscriptionData) {
    const users = await mgmtClient.getUsersByEmail(email);

    if (users.length !== 1) throw new Error(`Found ${users.length} users for email ${email}`);
    const [ user ] = users;

    // Drop any explicitly undefined fields
    (Object.keys(subscription) as Array<keyof SubscriptionData>).forEach(key =>
        subscription[key] === undefined ? delete subscription[key] : ''
    );

    await mgmtClient.updateAppMetadata({ id: user.user_id }, subscription);
}

function getSubscriptionFromHookData(hookData: WebhookData): SubscriptionData {
    if (
        hookData.alert_name === 'subscription_created' ||
        hookData.alert_name === 'subscription_updated'
    ) {
        // New subscription: get & store the full data for this user

        // 1 day of slack for ongoing renewals (we don't know what time they renew).
        const endDate = moment(hookData.next_bill_date).add(1, 'day').valueOf()

        return {
            subscription_status: hookData.status,
            subscription_id: parseInt(hookData.subscription_id, 10),
            subscription_plan_id: parseInt(hookData.subscription_plan_id, 10),
            subscription_expiry: endDate,
            update_url: hookData.update_url,
            cancel_url: hookData.cancel_url
        };
    } else if (hookData.alert_name === 'subscription_cancelled') {
        // Cancelled subscription - we'll never hear about this sub again. Mark is
        // as finished, and save the current end date so we know when it really stops.

        // Cancelled subscriptions end of the last day of the current plan
        const endDate = moment(hookData.cancellation_effective_date).valueOf();

        return {
            subscription_status: 'deleted',
            subscription_id: parseInt(hookData.subscription_id, 10),
            subscription_plan_id: parseInt(hookData.subscription_plan_id, 10),
            subscription_expiry: endDate,
            update_url: hookData.update_url,
            cancel_url: hookData.cancel_url
        };
    } else if (hookData.alert_name === 'subscription_payment_succeeded') {
        // Subscription has renewed (or started for the first time), update the expiry date.

        // 1 day of slack for ongoing renewals (we don't know what time they renew).
        const endDate = moment(hookData.next_bill_date).add(1, 'day').valueOf();

        return {
            subscription_status: hookData.status,
            subscription_id: parseInt(hookData.subscription_id, 10),
            subscription_plan_id: parseInt(hookData.subscription_plan_id, 10),
            subscription_expiry: endDate,
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

        return {
            subscription_status: hookData.next_retry_date ? 'past_due' : 'deleted',
            subscription_id: parseInt(hookData.subscription_id, 10),
            subscription_plan_id: parseInt(hookData.subscription_plan_id, 10),
            subscription_expiry: endDate,
            update_url: hookData.update_url,
            cancel_url: hookData.cancel_url,
        };
    }

    // Should never happen - effectively 'update nothing'
    return {};
}

export const handler = catchErrors(async (event: APIGatewayProxyEvent) => {
    const paddleData = querystring.parse(event.body) as unknown as WebhookData;
    console.log('Received Paddle webhook', paddleData);

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
        const subscription = getSubscriptionFromHookData(paddleData);

        console.log(`Updating user ${email} to ${JSON.stringify(subscription)}`);
        await saveUserData(email, subscription);
    } else {
        console.log(`Ignoring ${paddleData.alert_name} event`);
    }

    // All done
    return { statusCode: 200, body: '' };
});