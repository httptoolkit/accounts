import { initSentry, catchErrors } from '../errors';
initSentry();

import type { PricedSKU } from '../../../module/src/types';

import { getPaddleIdForSku } from '../paddle';
import { PricedSKUs } from '../products';

export const handler = catchErrors(async (event) => {
    const {
        email,
        sku,
        source
    } = event.queryStringParameters as {
        email?: string,
        sku?: PricedSKU,
        source?: string
    };

    if (!email || !sku || !PricedSKUs.includes(sku)) return {
        statusCode: 400,
        body: `Checkout requires specifying ${
            (!email && !sku)
                ? 'an email address and plan SKU'
            : !email
                ? 'an email address'
            : !sku
                ? 'the SKU for a subscription plan'
            // Unrecognized SKU:
                : 'a valid subscription plan SKU'
        }`
    };

    return {
        statusCode: 302,
        headers: {
            location: `https://pay.paddle.com/checkout/${
                getPaddleIdForSku(sku)
            }?guest_email=${
                encodeURIComponent(email)
            }&referring_domain=${source || 'unknown'}`
        },
        body: ''
    };
});