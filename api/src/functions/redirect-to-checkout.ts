import { initSentry, catchErrors, StatusError } from '../errors';
initSentry();

import type { PricedSKU } from '../../../module/src/types';

import * as Paddle from '../paddle';
import * as PayPro from '../paypro';

import { isProSubscription, isTeamSubscription, PricedSKUs } from '../products';
import { getAllPrices } from '../pricing';
import { getIpData } from '../ip-geolocate';
import { flushMetrics, generateSessionId, trackEvent } from '../metrics';

const PAYPRO_COUNTRIES = [
    'BRA',
    'IND',
    'CHN',
    'VNM',
    'MYS',
    'KOR',
    'PHL',
    'THA',
    'NLD',
    'ARE',
    'COD'
];

export const handler = catchErrors(async (event) => {
    const {
        // Both required:
        email, // But email can be * to explicitly let the user enter their own
        sku,
        quantity: quantityString, // Required for all Team SKUs, must not be set for Pro SKUs
        // Domain (app or website) opening this checkout:
        source,
        // Thank you page URL:
        returnUrl,
        // Metadata to pass through:
        passthrough: passthroughParameter
    } = event.queryStringParameters as {
        email?: string,
        sku?: PricedSKU,
        quantity?: string,
        source?: string,
        returnUrl?: string,
        passthrough?: string
    };

    console.log('Checkout query params:', event.queryStringParameters);

    const sourceIp = event.headers['x-nf-client-connection-ip']
        ?? event.requestContext?.identity.sourceIp;

    if (!email || !sku || !PricedSKUs.includes(sku)) throw new StatusError(400,
        `Checkout requires specifying ${
            (!email && !sku)
                ? 'an email address and plan SKU'
            : !email
                ? 'an email address'
            : !sku
                ? 'the SKU for a subscription plan'
            // Unrecognized SKU:
                : 'a valid subscription plan SKU'
        }`
    );

    let quantity: number | undefined;
    if (isTeamSubscription(sku)) {
        if (!quantityString) throw new StatusError(400, 'Quantity parameter is required for team SKUs');

        quantity = parseInt(quantityString);
        if (Number.isNaN(quantity)) throw new StatusError(400, `Could not parse provided quantity (${quantityString})`);
        if (quantity < 1) throw new StatusError(400, `Quantity must be >= 1 (was ${quantity})`);
        if (quantity % 1 !== 0) throw new StatusError(400, `Quantity must be an integer (was ${quantity})`);
    }

    const ipData = await getIpData(sourceIp);
    const productPrices = getAllPrices(ipData);

    // We pass through data to Paddle, so that we can easily check where the pricing that was
    // used came from, and debug any issues that pop up:
    let providedPassthroughData: any;
    try {
        providedPassthroughData = JSON.parse(passthroughParameter || '{}');
    } catch (e) {
        throw new Error(`Could not parse passthrough parameter: ${passthroughParameter}`);
    }

    const basePassthroughData = {
        id: generateSessionId(), // Random id unique to this checkout flow
        country: ipData?.countryCode3 ?? 'unknown',
        continent: ipData?.continentCode ?? 'unknown',
        hosting: ipData?.hosting || undefined,
        proxy: ipData?.hosting || undefined,
    };

    const passthrough = JSON.stringify(
        providedPassthroughData
        ? { ...providedPassthroughData, ...basePassthroughData }
        : basePassthroughData
    );

    // We use PayPro to handle payments only for Pro subscriptions, for a set of countries where
    // the wider support for global payment methods & currencies is likely to be useful:
    const paymentProvider = isProSubscription(sku) && PAYPRO_COUNTRIES.includes(ipData?.countryCode3!)
        ? 'paypro'
        : 'paddle';

    trackEvent(basePassthroughData.id, 'Checkout', 'Creation', {
        sku,
        paymentProvider,

        $set: {
            // Metadata for the checkout session in general:
            initial_referring_domain: source,
            country: ipData?.countryCode3 ?? 'unknown',
            continent: ipData?.continentCode ?? 'unknown',

            // Special keys that allow mapping in Posthog:
            $geoip_country_code: ipData?.countryCode,
            $geoip_continent_code: ipData?.continentCode
        }
    });
    const metricsPromise = flushMetrics(); // Flush, but async to avoid delays

    const checkoutFactory = paymentProvider === 'paypro'
        ? PayPro.createCheckout
        : Paddle.createCheckout;

    const checkoutUrl = await checkoutFactory({
        email: email === '*'
            ? undefined
            : email,
        sku,
        quantity,
        countryCode: ipData?.countryCode,
        currency: productPrices.currency,
        price: productPrices[sku],
        source: source || 'unknown',
        returnUrl,
        passthrough
    });

    await metricsPromise; // Make sure we log our overall checkout metrics

    return {
        statusCode: 302,
        headers: {
            // Very briefly cache this, to tighten up checkout loading performance:
            'cache-control': 'max-age=60',

            // Explicitly depend on the IP (though it doesn't matter much, given short
            // caching, since the user email in the URL should avoid any confusion):
            'vary': 'x-nf-client-connection-ip',

            location: checkoutUrl.includes('?')
                ? checkoutUrl
                : checkoutUrl + '?x' // Stop Netlify re-appending our original query params
        },
        body: ''
    };
});