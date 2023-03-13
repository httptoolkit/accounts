import * as forge from 'node-forge';

import { reportError } from './errors';
import { SKU } from "../../module/src/types";
import { getLatestRates } from './exchange-rates';

const PAYPRO_PARAM_KEY = process.env.PAYPRO_PARAM_KEY!;
const PAYPRO_PARAM_IV = process.env.PAYPRO_PARAM_IV!;

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
    checkoutParams.set('products[1][data]', forge.util.encode64(encryptedParams.bytes()));

    return `https://store.payproglobal.com/checkout?${checkoutParams.toString()}`;
}
