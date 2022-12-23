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

    const sourceIp = event.headers['x-nf-client-connection-ip']
        ?? event.requestContext.identity.sourceIp;

    try {
        const ipData = await getIpData(sourceIp);
        const productPrices = await getAllPrices(ipData);

        const pricingResult: Array<SubscriptionPricing> = PricedSKUs
        .map((sku) => ({
            sku,
            product_id: getPaddleIdForSku(sku),
            product_title: ProductDetails[sku].title,
            currency: productPrices.currency,
            price: { net: productPrices[sku] },
            subscription: { interval: ProductDetails[sku].interval }
        }))

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
    } catch (e) {
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