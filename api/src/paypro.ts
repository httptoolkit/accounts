import * as _ from 'lodash';
import * as crypto from 'crypto';
import * as forge from 'node-forge';
import fetch from 'node-fetch';
import * as moment from 'moment';

import { reportError, StatusError } from './errors';
import { SKU, TransactionData } from "../../module/src/types";
import { getLatestRates } from './exchange-rates';

const PAYPRO_API_BASE_URL = process.env.PAYPRO_API_BASE_URL
    ?? 'https://store.payproglobal.com';

const PAYPRO_ACCOUNT_ID = process.env.PAYPRO_ACCOUNT_ID;
const PAYPRO_API_KEY = process.env.PAYPRO_API_KEY;

const PAYPRO_PARAM_KEY = process.env.PAYPRO_PARAM_KEY!;
const PAYPRO_PARAM_IV = process.env.PAYPRO_PARAM_IV!;

const PAYPRO_IPN_VALIDATION_KEY = process.env.PAYPRO_IPN_VALIDATION_KEY;

const SKU_TO_PAYPRO_ID = {
    'pro-monthly': 79920,
    'pro-annual': 82586,
    'team-annual': 82587,
    'team-monthly': 82588,
    'pro-perpetual': -1 // Not supported via PayPro
};

// Taken from https://developers.payproglobal.com/docs/checkout-pages/url-parameters/#list-of-currencies-with-codes:
const PAYPRO_CURRENCIES = [
    "AFN",
    "DZD",
    "AED",
    "ARS",
    "AMD",
    "AUD",
    "AZN",
    "BSD",
    "BHD",
    "BDT",
    "BBD",
    "BYN",
    "BZD",
    "BMD",
    "BOB",
    "BWP",
    "BRL",
    "GBP",
    "BND",
    "BGN",
    "CAD",
    "CVE",
    "KYD",
    "XOF",
    "CLP",
    "COP",
    "CRC",
    "HRK",
    "CZK",
    "DKK",
    "DJF",
    "DOP",
    "XCD",
    "EGP",
    "EUR",
    "FJD",
    "GEL",
    "GTQ",
    "HNL",
    "HKD",
    "HUF",
    "ISK",
    "INR",
    "IDR",
    "ILS",
    "JOD",
    "KHR",
    "KZT",
    "KES",
    "BAM",
    "KRW",
    "KWD",
    "KGS",
    "LAK",
    "LBP",
    "MOP",
    "MKD",
    "MYR",
    "MVR",
    "MXN",
    "MDL",
    "MNT",
    "MAD",
    "NAD",
    "TRY",
    "NZD",
    "NGN",
    "NOK",
    "OMR",
    "PKR",
    "PAB",
    "PGK",
    "PYG",
    "PEN",
    "PHP",
    "PLN",
    "QAR",
    "RON",
    "RUB",
    "SAR",
    "RSD",
    "SGD",
    "ZAR",
    "LKR",
    "SEK",
    "CHF",
    "TWD",
    "TZS",
    "THB",
    "TMT",
    "TTD",
    "TND",
    "TJS",
    "UAH",
    "USD",
    "UYU",
    "UZS",
    "YER",
    "CNY",
    "JPY"
];

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
}) {
    const checkoutParams = new URLSearchParams();

    checkoutParams.set('currency', options.currency);

    if (options.discountCode) throw new Error('Discount codes are not supported by PayPro checkouts');

    if (options.email) checkoutParams.set('billing-email', options.email);
    if (options.countryCode) checkoutParams.set('billing-country', options.countryCode);
    if (options.source) checkoutParams.set('x-source', options.source);
    if (options.passthrough) checkoutParams.set('x-passthrough', options.passthrough);
    if (options.returnUrl) checkoutParams.set('x-return-url', options.returnUrl);

    // Product dynamic checkout params are encoded as URL params, but then encrypted
    // with a key, so that you can't just arbitrarily set them as you like. We use
    // this primarily so that we can directly control the pricing:
    const productParams = new URLSearchParams();

    // We include the currency only if PayPro understands it - otherwise
    // we drop it and send it converted as USD instead.
    if (PAYPRO_CURRENCIES.includes(options.currency)) {
        productParams.set(`price[${options.currency}][Amount]`, options.price.toString());
    } else {
        // We do report this though - it shouldn't happen normally, but we don't fail
        // hard here so we can support special cases later on (e.g. fallback from other
        // providers with different supported currencies, in emergencies)
        reportError(`Opening unsupported ${options.currency} PayPro checkout`);

        const allUsdRates = await getLatestRates('USD');
        const usdRate = allUsdRates[options.currency];

        if (!usdRate) throw new Error(
            `Can't show PayPro checkout for currency ${
                options.currency
            } with no USD rate available`
        );

        productParams.set(`price[USD][Amount]`, usdRate.toString());
    }

    // Encrypt our params, ready for use by PayPro's checkout:
    const cipher = forge.aes.createEncryptionCipher(PAYPRO_PARAM_KEY, 'CBC');
    cipher.start(PAYPRO_PARAM_IV);
    cipher.update(forge.util.createBuffer(productParams.toString()));
    cipher.finish();
    const encryptedParams = cipher.output;

    checkoutParams.set('products[1][id]', SKU_TO_PAYPRO_ID[options.sku].toString());
    if (options.quantity) checkoutParams.set('products[1][qty]', options.quantity.toString());
    checkoutParams.set('products[1][data]', forge.util.encode64(encryptedParams.bytes()));

    return `${PAYPRO_API_BASE_URL}/checkout?${checkoutParams.toString()}`;
}

export type PayProIPNTypes =
    | 'OrderCharged' // Initial subscription
    | 'OrderChargedBack' // Any chargeback
    | 'OrderOnWaiting' // Paid with a non-instant mechanism
    | 'SubscriptionRenewed' // Renewal
    | 'SubscriptionTerminated' // Cancellation
    | 'SubscriptionFinished' // Post-cancellation it's-really-over
    | 'SubscriptionChargeSucceed' // Recurring subscription charge
    | 'SubscriptionChargeFailed' // Subscription renewal charge failure
    | 'SubscriptionSuspended'; // Subscription paused

export interface PayProWebhookData {
    IPN_TYPE_NAME: PayProIPNTypes;

    HASH: string;
    SIGNATURE: string;
    TEST_MODE: '1' | '0';

    CUSTOMER_EMAIL: string;

    PRODUCT_ID: string;
    ORDER_ITEM_SKU: SKU;
    PRODUCT_QUANTITY: string;
    ORDER_ITEM_TOTAL_AMOUNT: string;

    CUSTOMER_ID: string;
    SUBSCRIPTION_ID: string; // Number as string.
    ORDER_PLACED_TIME_UTC: string; // Like "03/21/2023 19:02:59". Set for subscribe & renewal.
    INVOICE_LINK?: string;

    SUBSCRIPTION_STATUS_NAME: 'Active' | 'Suspended' | 'Terminated' | 'Finished';
    SUBSCRIPTION_NEXT_CHARGE_DATE: string; // Like "4/21/2023 1:45 PM" (UTC). "" once terminated.
    SUBSCRIPTION_RENEWAL_TYPE: 'Auto' | 'Manual';

    ORDER_ID: string;
    ORDER_STATUS: string;
    ORDER_TOTAL_AMOUNT: string;
    ORDER_CURRENCY_CODE: string; // E.g. EUR
    ORDER_CUSTOM_FIELDS: string; // a=b,b=c params, including x-passthrough=[JSON}
}

// All in Moment format:
export const PayProOrderDateFormat = 'MM/DD/YYYY HH:mm:ss';
export const PayProRenewalDateFormat = 'M/D/YYYY h:mm A';
export const PayProOrderDetailsDate = 'YYYY-MM-DDTHH:mm:ss.SSS'; // ISO minus timestamp

export function validatePayProWebhook(data: PayProWebhookData) {
    // PayPro only validates this limited set of fields (eugh) but as the
    // result is secret anyway, this should be sufficient for us to validate
    // the overall transaction came from PayPro (nobody can get the validation
    // key regardless, and you can't reuse any found hashes for any emails
    // other than the original).
    const key = [
        data.ORDER_ID,
        data.ORDER_STATUS,
        data.ORDER_TOTAL_AMOUNT,
        data.CUSTOMER_EMAIL,
        PAYPRO_IPN_VALIDATION_KEY,
        data.TEST_MODE,
        data.IPN_TYPE_NAME
    ].join('');

    const expectedSignature = crypto.createHash('sha256')
        .update(key)
        .digest('hex');

    if (data.SIGNATURE !== expectedSignature) {
        throw new StatusError(403, `PayPro IPN signature did not match - expected ${
            expectedSignature
        } but received ${
            data.SIGNATURE
        }`);
    }
}

export function parsePayProCustomFields(
    customFieldsData: string
) {
    // This format is _extremely_ poorly defined, and maybe impossible to parse correctly?
    // It's "k=v,k=v" but v can contain commas. Here's a best attempt at handling this:
    const customFieldMatch = /x-(\w+)=(.*?)(?=$|,x-\w+)/g;

    const result: Record<string, string> = {};

    while (true) {
        const match = customFieldMatch.exec(customFieldsData);
        if (!match) break;

        const fieldName = match[1];
        const fieldValue = match[2];
        result[fieldName] = fieldValue;
    }

    return result;
}

export async function cancelSubscription(subscriptionId: string | number) {
    const response = await fetch(`${PAYPRO_API_BASE_URL}/api/Subscriptions/Terminate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            vendorAccountId: PAYPRO_ACCOUNT_ID,
            apiSecretKey: PAYPRO_API_KEY,
            reasonText: 'API cancellation',
            sendCustomerNotification: true,
            subscriptionId: subscriptionId
        })
    });

    if (!response.ok) {
        console.log(`${response.status} ${response.statusText}`,
            response.headers,
            await response.text().catch(() => '')
        );
        throw new Error(`Unexpected ${response.status} during PayPro cancellation`);
    }

    const responseBody = await response.json();
    if (!responseBody.isSuccess) {
        console.log('PayPro errors:', responseBody.errors);
        throw new Error(`PayPro cancellation request failed`);
    }
}

// Order statuses: 1 – Waiting, 2 – Canceled, 3 – Refunded, 4 – Chargeback, 5 – Processed.
type OrderStatusId = number;
type OrderStatusName =
    | 'Waiting'
    | 'Canceled'
    | 'Refunded'
    | 'Chargeback'
    | 'Processed';

export interface PayProOrderListing {
    id: number,
    placedAtUtc: string, // E.g. "2023-03-20T17:27:31.44" (so ISO without timestamp, always UTC)
    invoiceUrl: string, // Full URL
    customerBillingEmail: string,
    orderStatusId: OrderStatusId,
    orderStatusName: OrderStatusName,
    paymentMethodName: string

}

export interface PayProOrderDetails {
    "orderId": number,
    "orderStatusId": OrderStatusId,
    "orderStatusName": OrderStatusName,
    "paymentMethodName": string,
    "createdAt": string // E.g. "2023-04-10T17:47:12.123" (so ISO without timestamp, always UTC)
    "billingCurrencyCode": string,
    "customer": { "email": string }
    "orderItems": Array<{
        "orderItemName": string,
        "sku": SKU,
        "quantity": number,
        "billingPrice": number
    }>,
    "invoiceLink": string, // Full URL
    "billingTotalPrice": number
}

export async function lookupPayProOrders(email: string): Promise<TransactionData[]> {
    const listResponse = await fetch(`${PAYPRO_API_BASE_URL}/api/Orders/GetList`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            vendorAccountId: PAYPRO_ACCOUNT_ID,
            apiSecretKey: PAYPRO_API_KEY,
            search: { customerEmail: email }
        })
    });

    if (!listResponse.ok) {
        console.log(`${listResponse.status} ${listResponse.statusText}`,
            listResponse.headers,
            await listResponse.text().catch(() => '')
        );
        throw new Error(`Unexpected ${listResponse.status} during PayPro order listing`);
    }

    const listResponseBody = await listResponse.json();
    if (!listResponseBody.isSuccess) {
        console.log('PayPro errors:', listResponseBody.errors);
        throw new Error(`PayPro order listing request failed`);
    }

    const orders = listResponseBody.response.orders as PayProOrderListing[];

    const rawOrders = await Promise.all(orders.map(async (order): Promise<PayProOrderDetails> => {
        const orderResponse = await fetch(`${PAYPRO_API_BASE_URL}/api/Orders/GetOrderDetails`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                vendorAccountId: PAYPRO_ACCOUNT_ID,
                apiSecretKey: PAYPRO_API_KEY,
                orderId: order.id
            })
        });

        if (!orderResponse.ok) {
            console.log(`${orderResponse.status} ${orderResponse.statusText}`,
                orderResponse.headers,
                await orderResponse.text().catch(() => '')
            );
            throw new Error(`Unexpected ${orderResponse.status} during PayPro order detail lookup`);
        }

        const orderResponseBody = await orderResponse.json();
        if (!orderResponseBody.isSuccess) {
            console.log('PayPro errors:', orderResponseBody.errors);
            throw new Error(`PayPro order detail lookup request failed`);
        }

        return orderResponseBody.response;
    }));

    return rawOrders.map((order): TransactionData => {
        if (order.orderItems.length !== 1) {
            throw new Error(
                `Unexpectedly found ${order.orderItems.length} orders in PayPro order ${order.orderId}`
            );
        }

        const orderItem = order.orderItems[0];

        const orderDate = moment.utc(order.createdAt, PayProOrderDetailsDate);
        const orderStatus = ({
            'Waiting': 'waiting',
            'Canceled': 'canceled',
            'Refunded': 'refunded',
            'Chargeback': 'disputed',
            'Processed': 'completed'
        } as const)[order.orderStatusName];

        if (!orderStatus) throw new Error(`Unrecognized PayPro order status: ${order.orderStatusName}`);

        return {
            order_id: order.orderId.toString(),
            amount: order.billingTotalPrice.toFixed(2),
            currency: order.billingCurrencyCode,
            receipt_url: order.invoiceLink,
            sku: orderItem.sku,
            status: orderStatus,
            created_at: orderDate.toISOString()
        };
    })
}