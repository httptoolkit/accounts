import { initSentry, catchErrors } from '../errors';
initSentry();

import moment from 'moment';
import * as querystring from 'querystring';
import { APIGatewayProxyEvent } from 'aws-lambda';

import { mgmtClient, User } from '../auth0';
import { validateWebhook, WebhookData, SubscriptionStatus, TEAM_SUBSCRIPTION_IDS, PRO_SUBSCRIPTION_IDS } from '../paddle';

interface SubscriptionData {
    paddle_user_id?: number,
    subscription_status?: SubscriptionStatus,
    subscription_id?: number,
    subscription_plan_id?: number,
    subscription_expiry?: number,
    subscription_quantity?: number,
    last_receipt_url?: string,
    update_url?: string,
    cancel_url?: string
}

interface TeamUserData extends SubscriptionData {
    team_member_ids?: string[];
    subscription_owner_id?: string;
}

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

async function updateProUserData(email: string, subscription: SubscriptionData) {
    const user = await getOrCreateUserData(email);

    dropUndefinedValues(subscription);
    await mgmtClient.updateAppMetadata({ id: user.user_id! }, subscription);
}

function getSubscriptionFromHookData(hookData: WebhookData): SubscriptionData {
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

        return {
            subscription_status: hookData.status,
            paddle_user_id: parseInt(hookData.user_id, 10),
            subscription_id: parseInt(hookData.subscription_id, 10),
            subscription_plan_id: parseInt(hookData.subscription_plan_id, 10),
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

        return {
            subscription_status: 'deleted',
            paddle_user_id: parseInt(hookData.user_id, 10),
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
            paddle_user_id: parseInt(hookData.user_id, 10),
            subscription_id: parseInt(hookData.subscription_id, 10),
            subscription_plan_id: parseInt(hookData.subscription_plan_id, 10),
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

        return {
            subscription_status: hookData.next_retry_date ? 'past_due' : 'deleted',
            paddle_user_id: parseInt(hookData.user_id, 10),
            subscription_id: parseInt(hookData.subscription_id, 10),
            subscription_plan_id: parseInt(hookData.subscription_plan_id, 10),
            subscription_expiry: endDate,
            update_url: hookData.update_url,
            cancel_url: hookData.cancel_url,
        };
    }

    // Should never happen - we effectively return 'update nothing'
    return {};
}

async function updateTeamData(email: string, subscription: SubscriptionData) {
    const currentUserData = await getOrCreateUserData(email);
    const currentMetadata: TeamUserData = currentUserData.app_metadata || {};
    const newMetadata = subscription as TeamUserData;

    if (!currentMetadata.team_member_ids) {
        // If the user is not currently a team owner: give them an empty team
        newMetadata.team_member_ids = [];
    }

    dropUndefinedValues(newMetadata);

    await mgmtClient.updateAppMetadata({ id: currentUserData.user_id! }, newMetadata);
}

export const handler = catchErrors(async (event: APIGatewayProxyEvent) => {
    const paddleData = querystring.parse(event.body || '') as unknown as WebhookData;
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

        let userData = getSubscriptionFromHookData(paddleData);

        if (TEAM_SUBSCRIPTION_IDS.includes(userData.subscription_plan_id!)) {
            console.log(`Updating team user ${email}`);
            await updateTeamData(email, userData);
        } else if (PRO_SUBSCRIPTION_IDS.includes(userData.subscription_plan_id!)) {
            console.log(`Updating Pro user ${email} to ${JSON.stringify(userData)}`);
            await updateProUserData(email, userData);
        } else {
            throw new Error(`Webhook received for unknown subscription: ${
                userData.subscription_plan_id
            }`);
        }
    } else {
        console.log(`Ignoring ${paddleData.alert_name} event`);
    }

    // All done
    return { statusCode: 200, body: '' };
});