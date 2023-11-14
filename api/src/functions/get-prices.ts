import { initSentry, catchErrors, reportError } from '../errors';
initSentry();

import { SubscriptionPricing } from '../../../module/src/types';

import { getCorsResponseHeaders } from '../cors';
import { getAllPrices } from '../pricing';
import { getPaddleIdForSku } from '../paddle';
import { PricedSKUs, ProductDetails } from '../products';
import { getIpData } from '../ip-geolocate';

export const handler = catchErrors(async (event) => {
    let headers = getCorsResponseHeaders(event, /.*/); // Pricing data is CORS-accessible anywhere

    if (event.httpMethod !== 'OPTIONS') {
        // Cache the per-user result for 1 hour
        headers['Cache-Control'] = 'private, max-age=3600';
    }

    const sourceIp = event.headers['x-nf-client-connection-ip'] // Netlify
        ?? event.requestContext?.identity.sourceIp; // Direct source - also populated by Express wrapper

    // Only sent by old clients, parsed here for backward compat:
    const { product_ids } = event.queryStringParameters as { product_ids?: string };
    const productIds = product_ids?.split(',');

    try {
        const ipData = await getIpData(sourceIp);
        const productPrices = getAllPrices(ipData);

        const pricingResult: Array<SubscriptionPricing> = PricedSKUs
        .map((sku) => ({
            sku,
            product_id: getPaddleIdForSku(sku),
            product_title: ProductDetails[sku].title,
            currency: productPrices.currency,
            price: { net: productPrices[sku] },
            subscription: { interval: ProductDetails[sku].interval }
        }));

        if (productIds?.includes("599788")) {
            // This is a hack, we basically return bad data, but no code (even old code)
            // should ever be using the pricing data here, so that's OK:
            pricingResult.push({
                sku: 'pro-perpetual',
                product_id: 599788,
                product_title: 'HTTP Toolkit Pro (perpetual)',
                currency: pricingResult[0].currency,
                price: { net: Infinity },
                subscription: { interval: 'perpetual' as any }
            })
        }

        return {
            statusCode: 200,
            headers: { ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                response: { products: pricingResult }
            })
        };
    } catch (e: any) {
        await reportError(e);
        return {
            statusCode: e.statusCode ?? 502,
            headers: { ...headers,
                'Cache-Control': 'no-store',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: false,
                error: e.message
            })
        };
    }
});