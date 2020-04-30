import { initSentry, catchErrors, reportError } from '../errors';
initSentry();

import fetch from 'node-fetch';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { getCorsResponseHeaders } from '../cors';

export const handler = catchErrors(async (event: APIGatewayProxyEvent) => {
    let headers = getCorsResponseHeaders(event);

    if (event.httpMethod !== 'OPTIONS') {
        // Cache the per-user result for 1 hour
        headers['Cache-Control'] = 'private, max-age=3600';
    }

    const sourceIp = event.headers['client-ip'];
    const { product_ids } = event.queryStringParameters as { product_ids?: string };

    if (!product_ids) throw new Error("Product ids required");

    const response = await fetch(`https://checkout.paddle.com/api/2.0/prices?product_ids=${product_ids}&quantity=1&customer_ip=${sourceIp}`);

    if (!response.ok) {
        console.log(`${response.status} ${response.statusText}`, response.headers, await response.text().catch(() => ''));
        reportError(`${response.status} error response from Paddle pricing API`);

        return {
            statusCode: response.status,
            headers: Object.assign(headers, { 'Cache-Control': 'no-store' }), // Drop our caching headers
            body: response.body
        };
    }

    const data = await response.json();

    if (!data.success) {
        // Forward the error on to the client, but report it - something is funky here.
        console.log(JSON.stringify(data));
        reportError("Unsuccessful response from Paddle pricing API");
    }

    // Set a 404 response code if any of the product ids couldn't be found. The client can
    // still use the other prices, but this is likely a problematic failure somewhere.
    const foundAllProducts = data.response.products.length === product_ids.split(',').length;

    return {
        statusCode: foundAllProducts ? 200 : 404,
        headers: Object.assign(headers, { 'content-type': 'application/json' }),
        body: JSON.stringify(data)
    };
});