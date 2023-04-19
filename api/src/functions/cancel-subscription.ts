import { initSentry, catchErrors, StatusError } from '../errors';
initSentry();

import { getCorsResponseHeaders } from '../cors';
import { getUserBaseData } from '../user-data';

import * as Paddle from '../paddle';
import * as PayPro from '../paypro';

const BearerRegex = /^Bearer (\S+)$/;

/*
This endpoint expects requests to be sent with a Bearer authorization,
containing a valid access token for the Auth0 app.

If the token is found and is usable, the user's payment details are loaded
and then used to make a request to their payment provider, cancelling their
subscription.
*/
export const handler = catchErrors(async (event) => {
    let headers = getCorsResponseHeaders(event);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    } else if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: '' };
    }

    const { authorization } = event.headers;

    const tokenMatch = BearerRegex.exec(authorization);
    if (!tokenMatch) return { statusCode: 401, headers, body: '' };
    const accessToken = tokenMatch[1];

    const userData = await getUserBaseData(accessToken);

    if (!('subscription_id' in userData) || !userData.subscription_id) {
        throw new StatusError(400,
            `Cannot cancel subscription for ${userData.email} as there's no subscription id set`
        );
    }

    if (!(userData.subscription_status === 'active' || userData.subscription_status === 'past_due')) {
        throw new StatusError(400,
            `Cannot cancel ${userData.subscription_status} subscription for user ${userData.email}`
        );
    }

    if (!userData.payment_provider || userData.payment_provider === 'paddle') {
        await Paddle.cancelSubscription(userData.subscription_id);
    } else if (userData.payment_provider === 'paypro') {
        await PayPro.cancelSubscription(userData.subscription_id);
    } else {
        throw new Error(`Can't cancel account from unrecognized provider: ${userData.payment_provider}`);
    }

    return {
        statusCode: 200,
        headers,
        body: ''
    };
});