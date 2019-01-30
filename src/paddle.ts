import * as crypto from 'crypto';
import * as Serialize from 'php-serialize';

const PADDLE_PUBLIC_KEY = `
-----BEGIN RSA PUBLIC KEY-----
${process.env.PADDLE_PUBLIC_KEY}
-----END RSA PUBLIC KEY-----
`;

export type PaddleAlertNames =
    | 'subscription_created'
    | 'subscription_updated'
    | 'subscription_cancelled'
    | 'subscription_payment_succeeded'
    | 'subscription_payment_failed'
    | 'subscription_payment_refunded'

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'deleted';

export interface BaseWebhookData {
    alert_name: PaddleAlertNames;
    event_time: string; // YYYY-MM-DD+HH:MM:SS
    p_signature: string;

    email: string;
    checkout_id: string;

    subscription_id: string;
    subscription_plan_id: string;
    status: SubscriptionStatus;

    update_url: string;
    cancel_url: string;
}

export interface SubscribeHookData extends BaseWebhookData {
    alert_name: 'subscription_created' | 'subscription_updated';
    next_bill_date: string; // YYYY-MM-DD
}

export interface CancellationHookData extends BaseWebhookData {
    alert_name: 'subscription_cancelled';
    cancellation_effective_date: string; // YYYY-MM-DD
}

export type WebhookData = SubscribeHookData | CancellationHookData;

function ksort<T extends {}>(obj: T): T {
    let keys = Object.keys(obj).sort();

    let sortedObj = {};
    for (let i in keys) {
        sortedObj[keys[i]] = obj[keys[i]];
    }

    return sortedObj as T;
}

// Closely based on code from https://paddle.com/docs/reference-verifying-webhooks
export function validateWebhook(webhookData: WebhookData) {
    const mySig = Buffer.from(webhookData.p_signature, 'base64');
    delete webhookData.p_signature;

    // Do some funky serializing to make this data match Paddle's signed form
    webhookData = ksort(webhookData);
    for (let property in webhookData) {
        if (
            webhookData.hasOwnProperty(property) &&
            (typeof webhookData[property]) !== "string"
        ) {
            if (Array.isArray(webhookData[property])) {
                webhookData[property] = webhookData[property].toString();
            } else {
                webhookData[property] = JSON.stringify(webhookData[property]);
            }
        }
    }
    const serialized = Serialize.serialize(webhookData);

    const verifier = crypto.createVerify('sha1');
    verifier.update(serialized);
    verifier.end();

    let verification = verifier.verify(PADDLE_PUBLIC_KEY, mySig);
    if (!verification) throw new Error('Webhook signature was invalid');
}