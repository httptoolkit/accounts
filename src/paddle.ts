import * as crypto from 'crypto';
import Serialize from 'php-serialize';

const PADDLE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
${process.env.PADDLE_PUBLIC_KEY}
-----END PUBLIC KEY-----`;

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

export interface NewSubscriptionHookData extends BaseWebhookData {
    alert_name: 'subscription_created';
    quantity: string; // \d+
    next_bill_date: string; // YYYY-MM-DD
}

export interface UpdatedSubscriptionHookData extends BaseWebhookData {
    alert_name: 'subscription_updated';
    new_quantity: string; // \d+
    next_bill_date: string; // YYYY-MM-DD
}

export interface CancellationHookData extends BaseWebhookData {
    alert_name: 'subscription_cancelled';
    cancellation_effective_date: string; // YYYY-MM-DD
}

export interface PaymentSuccessHookData extends BaseWebhookData {
    alert_name: 'subscription_payment_succeeded';
    next_bill_date: string; // YYYY-MM-DD
    receipt_url: string;
    quantity: string; // \d+
}

export interface PaymentRefundedHookData extends BaseWebhookData {
    alert_name: 'subscription_payment_refunded';
    next_bill_date: string; // YYYY-MM-DD
}

export interface PaymentFailedHookData extends BaseWebhookData {
    alert_name: 'subscription_payment_failed';
    hard_failure: boolean;
    next_retry_date?: string; // YYYY-MM-DD
}

export type WebhookData =
    | NewSubscriptionHookData
    | UpdatedSubscriptionHookData
    | CancellationHookData
    | PaymentSuccessHookData
    | PaymentRefundedHookData
    | PaymentFailedHookData;

export type UnsignedWebhookData = Omit<WebhookData, 'p_signature'>;

function ksort<T extends {}>(obj: T): T {
    let keys = Object.keys(obj).sort() as Array<keyof T>;

    let sortedObj: Partial<T> = {};
    for (let i in keys) {
        sortedObj[keys[i]] = obj[keys[i]];
    }

    return sortedObj as T;
}

export function serializeWebhookData(webhookData: UnsignedWebhookData) {
    const sortedData: { [key: string]: any } = ksort(webhookData);
    for (let property in sortedData) {
        if (
            sortedData.hasOwnProperty(property) &&
            (typeof sortedData[property]) !== "string"
        ) {
            if (Array.isArray(sortedData[property])) {
                sortedData[property] = sortedData[property].toString();
            } else {
                sortedData[property] = JSON.stringify(sortedData[property]);
            }
        }
    }

    return Serialize.serialize(sortedData);
}

// Closely based on code from https://paddle.com/docs/reference-verifying-webhooks
export function validateWebhook(webhookData: WebhookData) {
    const mySig = Buffer.from(webhookData.p_signature, 'base64');
    delete webhookData.p_signature;

    // Do some normalization & serializing, to make this data match Paddle's signed form
    const serializedData = serializeWebhookData(webhookData);

    const verifier = crypto.createVerify('sha1');
    verifier.update(serializedData);
    verifier.end();

    let verification = verifier.verify(PADDLE_PUBLIC_KEY, mySig);
    if (!verification) throw new Error('Webhook signature was invalid');
}