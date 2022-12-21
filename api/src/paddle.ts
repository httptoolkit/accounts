import _ from 'lodash';
import * as crypto from 'crypto';
import { URLSearchParams } from 'url';

import fetch, { RequestInit } from 'node-fetch';
import Serialize from 'php-serialize';

import { StatusError } from './errors';
import { SKU, SubscriptionStatus, TransactionData } from '../../module/src/types';

const PADDLE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
${process.env.PADDLE_PUBLIC_KEY}
-----END PUBLIC KEY-----`;

const PADDLE_VENDOR_ID = process.env.PADDLE_ID;
const PADDLE_KEY = process.env.PADDLE_KEY;

const PADDLE_BASE_URL = process.env.PADDLE_BASE_URL || "https://vendors.paddle.com";

// Map the legacy Paddle subscription plan IDs to SKUs
const PADDLE_ID_TO_SKU = {
    550380: 'pro-monthly',
    550382: 'pro-annual',
    599788: 'pro-perpetual',
    550789: 'team-monthly',
    550788: 'team-annual'
} as const;

type PADDLE_PLAN_ID = keyof typeof PADDLE_ID_TO_SKU;
export const getSkuForPaddleId = (id: number | undefined) =>
    id
    ? PADDLE_ID_TO_SKU[id as PADDLE_PLAN_ID]
    : undefined;

const SKU_TO_PADDLE_ID = _.mapValues(
    _.invert(PADDLE_ID_TO_SKU),
    v => parseInt(v, 10)
);

export const getPaddleIdForSku = (sku: SKU) => {
    const planId = SKU_TO_PADDLE_ID[sku];
    if (!planId) throw new Error(`Invalid SKU: ${sku}`);
    return planId;
}

export type PaddleAlertNames =
    | 'subscription_created'
    | 'subscription_updated'
    | 'subscription_cancelled'
    | 'subscription_payment_succeeded'
    | 'subscription_payment_failed'
    | 'subscription_payment_refunded'
    | 'payment_dispute_created';

export interface BaseWebhookData {
    alert_name: PaddleAlertNames;
    event_time: string; // YYYY-MM-DD+HH:MM:SS
    p_signature: string;

    email: string;
    checkout_id: string;

    user_id: string; // \d+
    subscription_id: string; // \d+
    subscription_plan_id: string; // \d+
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

export interface DisputeCreatedData extends BaseWebhookData {
    alert_name: 'payment_dispute_created';
}

export type WebhookData =
    | NewSubscriptionHookData
    | UpdatedSubscriptionHookData
    | CancellationHookData
    | PaymentSuccessHookData
    | PaymentRefundedHookData
    | PaymentFailedHookData
    | DisputeCreatedData;

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
    delete (webhookData as Partial<WebhookData>).p_signature;

    // Do some normalization & serializing, to make this data match Paddle's signed form
    const serializedData = serializeWebhookData(webhookData);

    const verifier = crypto.createVerify('sha1');
    verifier.update(serializedData);
    verifier.end();

    let verification = verifier.verify(PADDLE_PUBLIC_KEY, mySig);
    if (!verification) throw new Error('Webhook signature was invalid');
}

async function makePaddleApiRequest(url: string, options: RequestInit = {}) {
    url = url.startsWith('/')
        ? PADDLE_BASE_URL + url
        : url;

    const response = await fetch(url, options);

    if (!response.ok) {
        console.log(`${response.status} ${response.statusText}`,
            response.headers,
            await response.text().catch(() => '')
        );
        throw new Error(`${response.status} error response from Paddle API`);
    }

    const data = await response.json();

    if (!data.success) {
        console.log(`Unsuccessful Paddle response: `, JSON.stringify(data));
        throw new Error("Unsuccessful response from Paddle API");
    }

    return data.response;
}

export async function getPrices(productIds: string[], sourceIp: string): Promise<any[]> {
    const response = await makePaddleApiRequest(`https://checkout.paddle.com/api/2.0/prices?product_ids=${
        productIds.join(',')
    }&quantity=1&customer_ip=${
        sourceIp
    }`);

    const { products } = response;

    // Paddle API returns success even if some ids aren't recognized or returned, so
    // we need an extra error case to check that:
    const foundAllProducts = products.length === productIds.length;
    if (!foundAllProducts) {
        console.log(`Missing products. Expected ${productIds.join(',')}, found ${
            products.map((p: any) => p.product_id)
        }`);
        throw new StatusError(404,
            "Paddle pricing API did not return all requested products"
        );
    }

    return response.products;
}

export async function getPaddleUserIdFromSubscription(
    subscriptionId: number | undefined
): Promise<number | undefined> {
    if (!subscriptionId) return undefined;

    const response = await makePaddleApiRequest(
        `/api/2.0/subscription/users`, {
            method: 'POST',
            body: new URLSearchParams({
                vendor_id: PADDLE_VENDOR_ID,
                vendor_auth_code: PADDLE_KEY,
                subscription_id: subscriptionId.toString()
            })
        }
    );

    if (response.length === 0) {
        throw new Error(`Unrecognized subscription id ${subscriptionId}`);
    } else if (response.length > 1) {
        throw new Error(`Multiple users for subscription id ${subscriptionId}`);
    } else {
        // Exactly one matching user:
        return response[0].user_id as number;
    }
}

export async function getPaddleUserTransactions(
    userId: number
): Promise<TransactionData[]> {
    const response = await makePaddleApiRequest(
        `/api/2.0/user/${userId}/transactions`, {
            method: 'POST',
            body: new URLSearchParams({
                vendor_id: PADDLE_VENDOR_ID,
                vendor_auth_code: PADDLE_KEY
            })
        }
    );

    // Expose this data as objects with only the minimal set of relevant keys for now:
    return response.map((transaction: TransactionData) => _.pick(transaction, [
        'order_id',
        'receipt_url',
        'product_id',
        'created_at',
        'status',
        'currency',
        'amount'
    ]));
}