import * as _ from 'lodash';
import * as crypto from 'crypto';
import * as forge from 'node-forge';

import { reportError, StatusError } from './errors';
import { SKU } from "../../module/src/types";
import { getLatestRates } from './exchange-rates';

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
    countryCode?: string,
    currency: string,
    price: number,
    source: string,
    returnUrl?: string,
    passthrough?: string
}) {
    const checkoutParams = new URLSearchParams();

    checkoutParams.set('currency', options.currency);

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

    return `https://store.payproglobal.com/checkout?${checkoutParams.toString()}`;
}

export type PayProIPNTypes =
    | 'OrderCharged' // Initial subscription
    | 'OrderChargedBack' // Any chargeback
    | 'OrderOnWaiting' // Paid with a non-instant mechanism
    | 'SubscriptionRenewed' // Renewal
    | 'SubscriptionTerminated' // Cancellation
    | 'SubscriptionFinished' // Post-cancellation it's-really-over
    | 'SubscriptionChargeSucceed' // Any (recurring + initial?) subscription charge
    | 'SubscriptionChargeFailed' // Any (ditto?) failure
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

    CUSTOMER_ID: string;
    SUBSCRIPTION_ID: string; // Number as string.
    ORDER_PLACED_TIME_UTC: string; // Like "03/01/2023 19:02:59"
    INVOICE_URL?: string;

    SUBSCRIPTION_STATUS_NAME: 'Active' | 'Suspended' | 'Terminated' | 'Finished';
    SUBSCRIPTION_NEXT_CHARGE_DATE: string; // Like "4/21/2023 1:45 PM" (UTC)
    SUBSCRIPTION_RENEWAL_TYPE: 'Auto' | 'Manual';

    ORDER_ID: string;
    ORDER_STATUS: string;
    ORDER_TOTAL_AMOUNT: string;
    ORDER_CUSTOM_FIELDS: string; // a=b,b=c params, including x-passthrough=[JSON}
}

export const PayProOrderDateFormat = 'MM/DD/YYYY HH:mm:ss';
export const PayProRenewalDateFormat = 'M/D/YYYY h:mm A';

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