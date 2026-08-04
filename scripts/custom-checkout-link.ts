#!./node_modules/.bin/tsx

import prompts from 'prompts';

import * as paddle from '../api/src/paddle';
import * as paypro from '../api/src/paypro';
import { PricedSKUs, ProductDetails, isTeamSubscription } from '../api/src/products';

// Create a one-off checkout link with a custom price, for manual deals (custom pricing,
// negotiated discounts, unusual currencies, etc). This only builds the link via the payment
// provider - it makes no account, database or metrics changes. The subscription itself is
// created by the usual webhook handling, if & when the customer actually pays.

const SOURCE = 'manual-checkout-link';
const RETURN_URL = 'https://httptoolkit.com/web-purchase-thank-you/';

const USAGE = 'Usage: custom-checkout-link <email|*> <sku> <quantity> <currency> <amount> ' +
    '<paddle|paypro> [country-code] [discount-code]';

const REQUIRED_ENV_VARS = {
    paddle: ['PADDLE_ID', 'PADDLE_KEY'],
    paypro: ['PAYPRO_PARAM_KEY', 'PAYPRO_PARAM_IV']
};

(async () => {
    const email = process.argv[2];
    const sku = process.argv[3] as typeof PricedSKUs[number];
    const quantityInput = process.argv[4];
    const currency = process.argv[5]?.toUpperCase();
    const amount = +process.argv[6];
    const paymentProvider = process.argv[7] as 'paddle' | 'paypro';
    const countryCode = process.argv[8]?.toUpperCase();
    const discountCode = process.argv[9];

    if (process.argv.length < 8) throw new Error(USAGE);

    // Email can be * to create an open link, where the customer enters their own address:
    if (email !== '*' && !email.includes('@')) {
        throw new Error(`Email must be an email address, or * for an open link, was '${email}'`);
    }

    if (!PricedSKUs.includes(sku)) {
        throw new Error(`SKU must be one of: ${PricedSKUs.join(', ')}`);
    }

    const quantity = +quantityInput;
    if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error(`Quantity must be a positive integer, was '${quantityInput}'`);
    }
    if (!isTeamSubscription(sku) && quantity !== 1) {
        throw new Error(`Quantity must be 1 for non-team SKUs, was ${quantity}`);
    }

    if (paymentProvider !== 'paddle' && paymentProvider !== 'paypro') {
        throw new Error(`Payment provider must be paddle or paypro, was '${paymentProvider}'`);
    }

    const supportedCurrencies = paymentProvider === 'paddle'
        ? paddle.PADDLE_CURRENCIES
        : paypro.PAYPRO_CURRENCIES;

    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
        throw new Error(`Currency must be a 3-letter code, e.g. EUR, was '${process.argv[5]}'`);
    }

    if (!supportedCurrencies.includes(currency)) {
        throw new Error(`Currency ${currency} is not supported by ${paymentProvider}.\n` +
            `Supported currencies are: ${supportedCurrencies.join(', ')}`);
    }

    if (isNaN(amount) || amount <= 0) {
        throw new Error(`Amount must be a positive number, was '${process.argv[6]}'`);
    }

    // Both providers expect an ISO alpha-2 country code here (unlike our pricing config,
    // which is keyed by alpha-3 codes):
    if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
        throw new Error(`Country code must be a 2-letter code (e.g. GB, US), was '${countryCode}'`);
    }

    if (discountCode && paymentProvider === 'paypro') {
        throw new Error('Discount codes are not supported by PayPro checkouts');
    }

    const missingEnvVars = REQUIRED_ENV_VARS[paymentProvider]
        .filter((name) => !process.env[name]);
    if (missingEnvVars.length) {
        throw new Error(`Missing ${paymentProvider} configuration: ${missingEnvVars.join(', ')}`);
    }

    const { title, interval } = ProductDetails[sku];
    const total = amount * quantity;

    console.log(`
Checkout details:

  Email:      ${email === '*' ? '(open link - customer enters their own)' : email}
  Plan:       ${title} (${sku})
  Quantity:   ${quantity}
  Price:      ${amount} ${currency} per licence per ${interval}${quantity > 1
    ? `, i.e. ${total} ${currency} per ${interval} in total`
    : ''}
  Provider:   ${paymentProvider}
  Country:    ${countryCode ?? '(customer selects during checkout)'}
  Discount:   ${discountCode ?? '(none)'}
`);

    const { result } = await prompts({
        name: 'result',
        type: 'confirm',
        message: 'Create this checkout link?'
    });

    if (!result) {
        console.log('Cancelled');
        process.exit(1);
    }

    const createCheckout = paymentProvider === 'paddle'
        ? paddle.createCheckout
        : paypro.createCheckout;

    const checkoutUrl = await createCheckout({
        email: email === '*'
            ? undefined
            : email,
        sku,
        // Matching the normal checkout flow, we only lock the quantity for team plans:
        quantity: isTeamSubscription(sku) ? quantity : undefined,
        discountCode,
        countryCode,
        currency,
        price: amount,
        source: SOURCE,
        returnUrl: RETURN_URL,
        passthrough: JSON.stringify({
            country: countryCode ?? 'unknown',
            source: SOURCE
        })
    });

    console.log(checkoutUrl);
})();
