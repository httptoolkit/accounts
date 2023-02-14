import { initSentry, catchErrors } from '../errors';
initSentry();

import type { PricedSKU } from '../../../module/src/types';

import { createCheckout, getPaddleIdForSku } from '../paddle';
import { PricedSKUs } from '../products';
import { getAllPrices } from '../pricing';
import { getIpData } from '../ip-geolocate';

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

    const sourceIp = event.headers['x-nf-client-connection-ip']
        ?? event.requestContext?.identity.sourceIp;

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

    const ipData = await getIpData(sourceIp);
    const productPrices = getAllPrices(ipData);

    const checkoutUrl = await createCheckout({
        email,
        productId: getPaddleIdForSku(sku),
        countryCode: ipData?.countryCode,
        currency: productPrices.currency,
        price: productPrices[sku],
        source: source || 'unknown'
    });

    return {
        statusCode: 302,
        headers: {
            // Very briefly cache this, to tighten up checkout loading performance:
            'cache-control': 'max-age=60',

            // Explicitly depend on the IP (though it doesn't matter much, given short
            // caching, since the user email in the URL should avoid any confusion):
            'vary': 'x-nf-client-connection-ip',

            location: checkoutUrl
        },
        body: ''
    };
});