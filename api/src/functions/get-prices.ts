import { initSentry, catchErrors, reportError } from '../errors';
initSentry();

import { getCorsResponseHeaders } from '../cors';
import { getPrices } from '../paddle';

export const handler = catchErrors(async (event) => {
    let headers = getCorsResponseHeaders(event);

    if (event.httpMethod !== 'OPTIONS') {
        // Cache the per-user result for 1 hour
        headers['Cache-Control'] = 'private, max-age=3600';
    }

    const sourceIp = event.headers['x-nf-client-connection-ip'];

    const { product_ids } = event.queryStringParameters as { product_ids?: string };

    if (!product_ids) throw new Error("Product ids required");

    const productIds = product_ids.split(',');

    try {
        const prices = await getPrices(productIds, sourceIp);

        return {
            statusCode: 200,
            headers: { ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                response: { products: prices }
            })
        };
    } catch (e) {
        reportError(e);
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