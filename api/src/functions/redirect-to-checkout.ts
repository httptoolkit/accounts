import { initSentry, catchErrors } from '../errors';
initSentry();

import type { SKU } from '../../../module/src/types';

import { getPaddleIdForSku } from '../paddle';
import { SKUs } from '../products';

export const handler = catchErrors(async (event) => {
    const sourceDomain = event.headers['referring_domain'] as string | undefined;

    const {
        email,
        sku
    } = event.queryStringParameters as { email?: string, sku?: SKU };

    if (!email || !sku || !SKUs.includes(sku)) return {
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
            }&referring_domain=${sourceDomain || 'unknown'}`
        },
        body: ''
    };
});