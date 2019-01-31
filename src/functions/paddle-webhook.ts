import { initSentry, catchErrors } from '../errors';
initSentry();

import * as moment from 'moment';
import * as querystring from 'querystring';
import { APIGatewayProxyEvent } from 'aws-lambda';

import { mgmtClient } from '../auth0';
import { validateWebhook, WebhookData } from '../paddle';

interface SubscriptionData {
    subscription_id?: number,
    subscription_plan_id?: number,
    subscription_expiry?: number,
    update_url?: string,
    cancel_url?: string
}

async function saveUserData(email: string, subscription: SubscriptionData) {
    const users = await mgmtClient.getUsersByEmail(email);

    if (users.length !== 1) throw new Error(`Found ${users.length} users for email ${email}`);
    const [ user ] = users;

    await mgmtClient.updateAppMetadata({ id: user.user_id }, subscription);
}

function getSubscriptionFromHookData(hookData: WebhookData): SubscriptionData {
    if (hookData.status === 'active') {
        const endDate =
            hookData.alert_name === 'subscription_cancelled' ?
                // Cancelled subscriptions end of the last day of the current plan
                moment(hookData.cancellation_effective_date).valueOf() :
                // 1 day of slack for ongoing renewals (we don't know what time they renew).
                moment(hookData.next_bill_date).add(1, 'day').valueOf()

        return {
            subscription_id: parseInt(hookData.subscription_id, 10),
            subscription_plan_id: parseInt(hookData.subscription_plan_id, 10),
            subscription_expiry: endDate,
            update_url: hookData.update_url,
            cancel_url: hookData.cancel_url
        };
    } else {
        return {
            subscription_id: undefined,
            subscription_plan_id: undefined,
            subscription_expiry: undefined,
            update_url: undefined,
            cancel_url: undefined
        };
    }
}

export const handler = catchErrors(async (event: APIGatewayProxyEvent) => {
    const paddleData = querystring.parse(event.body) as unknown as WebhookData;
    console.log('Received Paddle webhook', paddleData);

    validateWebhook(paddleData);

    if ([
        'subscription_created',
        'subscription_updated',
        'subscription_cancelled'
    ].includes(paddleData.alert_name)) {
        const subscription = getSubscriptionFromHookData(paddleData);

        console.log(`Updating user ${paddleData.email} to ${JSON.stringify(subscription)}`);
        await saveUserData(paddleData.email, subscription);
    } else {
        console.log(`Ignoring ${paddleData.alert_name} event`);
    }

    // All done
    return { statusCode: 200, body: '' };
});