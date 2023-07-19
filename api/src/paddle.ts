import _ from 'lodash';
import * as crypto from 'crypto';
import { URLSearchParams } from 'url';

import fetch, { RequestInit } from 'node-fetch';
import Serialize from 'php-serialize';
import NodeCache from 'node-cache';
import moment from 'moment';
import { TypedError } from 'typed-error';

import { reportError, StatusError } from './errors';
import { getLatestRates } from './exchange-rates';
import {
    SKU,
    SubscriptionPricing,
    SubscriptionStatus,
    TransactionData
} from '../../module/src/types';

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
    passthrough?: string; // JSON with checkout metadata (by our convention)
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

export type PaddleWebhookData =
    | NewSubscriptionHookData
    | UpdatedSubscriptionHookData
    | CancellationHookData
    | PaymentSuccessHookData
    | PaymentRefundedHookData
    | PaymentFailedHookData
    | DisputeCreatedData;

export type UnsignedWebhookData = Omit<PaddleWebhookData, 'p_signature'>;

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
export function validatePaddleWebhook(webhookData: PaddleWebhookData) {
    const mySig = Buffer.from(webhookData.p_signature, 'base64');
    delete (webhookData as Partial<PaddleWebhookData>).p_signature;

    // Do some normalization & serializing, to make this data match Paddle's signed form
    const serializedData = serializeWebhookData(webhookData);

    const verifier = crypto.createVerify('sha1');
    verifier.update(serializedData);
    verifier.end();

    let verification = verifier.verify(PADDLE_PUBLIC_KEY, mySig);
    if (!verification) throw new Error('Webhook signature was invalid');
}

export class PaddleApiError extends TypedError {
    constructor(
        public readonly code?: number,
        public readonly message: string = 'Unknown Paddle error'
    ) {
        super(`Unsuccessful response from Paddle API: ${message} (${code})`);
    }
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
        const errorCode = data.error?.code;
        const errorMessage = data.error?.message;
        throw new PaddleApiError(errorCode, errorMessage);
    }

    return data.response;
}

export async function getPrices(productIds: string[], sourceIp: string): Promise<SubscriptionPricing[]> {
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
    subscriptionId: number | string | undefined
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

export interface PaddleTransaction {
    order_id: string; // Used as key
    receipt_url: string;
    product_id: number; // Used to show plan name for this order
    created_at: string; // E.g. "2020-09-03 02:50:36" in UTC

    status: 'completed' | 'refunded' | 'partially_refunded' | 'disputed';
    // Status is shown in the dashboard, title cased.

    currency: string;
    amount: string;
}

export async function lookupPaddleUserTransactions(
    userId: string | number
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

    // Expose this data as objects with minor trimming & transformation:
    return response.map((transaction: PaddleTransaction) => ({
        ..._.pick(transaction, [
            'order_id',
            'receipt_url',
            'status',
            'currency',
            'amount'
        ]),
        // Switch to UTC ISO from Paddle's funky date format:
        created_at: moment.utc(
            transaction.created_at,
            "YYYY-MM-DD HH:mm:ss"
        ).toISOString(),
        sku: getSkuForPaddleId(transaction.product_id)
    }));
}

// Taken from https://www.paddle.com/help/start/intro-to-paddle/what-currencies-do-you-support
const PADDLE_CURRENCIES = [
    "ARS",
    "AUD",
    "BRL",
    "GBP",
    "CAD",
    "CNY",
    "CZK",
    "DKK",
    "EUR",
    "HKD",
    "HUF",
    "INR",
    "ILS",
    "JPY",
    "MXN",
    "TWD",
    "NZD",
    "NOK",
    "PLN",
    "RUB",
    "SGD",
    "ZAR",
    "KRW",
    "SEK",
    "CHF",
    "THB",
    "TRY",
    "UAH",
    "USD"
];

// We cache checkouts, so that we can send requests to pre-calculate them, and
// thereby drop ~500ms in checkout time (probably good for conversion) and make
// ourselves a tiny bit more resilient to checkout blips.
const checkoutCache = new NodeCache({
    stdTTL: 60 // Cached for 1h
});

export async function createCheckout(options: {
    sku: SKU,
    email?: string, // Almost always set, except manual purchase links
    quantity?: number, // Always set for team accounts
    discountCode?: string,
    countryCode?: string,
    currency: string,
    price: number,
    source: string,
    returnUrl?: string,
    passthrough?: string
}): Promise<string> {
    const cacheKey = JSON.stringify(options);
    if (checkoutCache.has(cacheKey)) return checkoutCache.get<string>(cacheKey)!;

    const productId = getPaddleIdForSku(options.sku);

    const prices: { [currency: string]: number } = {};

    // We include the currency only if Paddle understands it - otherwise
    // we drop it - we'll send it converted as EUR anyway.
    if (PADDLE_CURRENCIES.includes(options.currency)) {
        prices[options.currency] = options.price;
    } else {
        // We do report this though - it shouldn't happen normally, but we don't fail
        // hard here so we can support special cases later on (e.g. fallback from other
        // providers with different supported currencies, in emergencies)
        reportError(`Opening unsupported ${options.currency} Paddle checkout`);
    }

    if (options.currency !== 'EUR') {
        // We must always provide an EUR price, because a) Paddle's API
        // requires it, and b) the user might change their country during
        // checkout. We always use the direct conversion to EUR, so that
        // the price they pay is the same - just the currency can vary.

        const allEurRates = await getLatestRates('EUR');
        const eurRate = allEurRates[options.currency];

        if (!eurRate) {
            console.log(`Missing rate for ${options.currency}, available rates are:`, allEurRates);
            throw new Error(
                `Can't show Paddle checkout for currency ${
                    options.currency
                } with no EUR rate available`
            );
        }

        const eurPrice = options.price / eurRate;
        prices['EUR'] = eurPrice;
    }

    // Prices should now contain an EUR price, plus an equivalent non-EUR price if
    // the original pricing is some Paddle-supported currency. We leave currency
    // selection to Paddle, but assume that the currency will match the country, so
    // Paddle will show that by default. If it doesn't, you'll get the conversion
    // from EUR - messy, but equivalent so acceptable.

    // We have to send prices in price[0]=EUR:123 format, so we collapse our
    // array into separate object keys here:
    const priceParams = Object.entries(prices)
        .reduce((priceParams, [currency, price], i) => {
            const pricing = `${currency}:${price}`;
            priceParams[`prices[${i}]`] = pricing;
            // We also need the same value as recurring pricing:
            priceParams[`recurring_prices[${i}]`] = pricing;
            return priceParams;
        }, {} as { [key: string]: string })

    const checkoutParams = new URLSearchParams({
        vendor_id: PADDLE_VENDOR_ID,
        vendor_auth_code: PADDLE_KEY,
        product_id: productId.toString(),

        ...(options.email
            ? { customer_email: options.email }
            : {}
        ),
        ...(options.countryCode
            ? { customer_country: options.countryCode }
            : {}
        ),

        ...(options.quantity !== undefined
            ? {
                quantity: options.quantity.toString(),
                allowQuantity: 'false' // If set, don't let them change it
            }
            : {}
        ),

        ...(options.discountCode
            ? { coupon_code: options.discountCode }
            : {}
        ),

        referring_domain: options.source,
        ...(options.returnUrl
            ? { return_url: options.returnUrl }
            : {}
        ),
        ...(options.passthrough
            ? { passthrough: options.passthrough }
            : {}
        ),
        ...priceParams
    });

    try {
        const response = await makePaddleApiRequest(
            `/api/2.0/product/generate_pay_link`, {
                method: 'POST',
                body: checkoutParams
            }
        );

        checkoutCache.set<string>(cacheKey, response.url);

        return response.url as string;
    } catch (e) {
        if (e instanceof PaddleApiError && e.code === 175) {
            // 175 => Invalid country code (https://developer.paddle.com/api-reference/324ed7bfd28c8-api-error-codes#list-of-error-codes-and-messages)

            reportError(`Paddle checkout creation failure due to ${options.countryCode} country code`);

            // Paddle can reject some country codes. Here we work around that, by just skipping the country
            // entirely in that case, and the user can sort it themselves (or fight with Paddle's support team
            // and complain directly, if not):
            return createCheckout({
                ...options,
                countryCode: undefined
            });
        } else {
            throw e;
        }
    }
}

export async function cancelSubscription(subscriptionId: string | number) {
    await makePaddleApiRequest(
        `/api/2.0/subscription/users_cancel`, {
            method: 'POST',
            body: new URLSearchParams({
                vendor_id: PADDLE_VENDOR_ID,
                vendor_auth_code: PADDLE_KEY,
                subscription_id: subscriptionId.toString()
            })
        }
    );
}