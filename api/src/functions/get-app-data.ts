import { initSentry, catchErrors } from '../errors';
initSentry();

import * as jwt from 'jsonwebtoken';

import { DATA_SIGNING_PRIVATE_KEY } from '../user-data-facade';
import { getCorsResponseHeaders } from '../cors';
import { getUserAppData } from '../user-data';

const BearerRegex = /^Bearer (\S+)$/;

/*
This endpoint expects requests to be sent with a Bearer authorization,
containing a valid access token for the Auth0 app.

If the token is found and is usable, the user's app data (email, subscription
status & feature flags) are loaded and signed into a JWT, so the app can
read that info, and confirm its validity.
*/
export const handler = catchErrors(async (event) => {
    let headers = getCorsResponseHeaders(event);

    if (event.httpMethod !== 'OPTIONS') {
        // Very briefly cache results, to avoid completely unnecessary calls
        headers['Cache-Control'] = 'private, max-age=10';
    }

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    } else if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: '' };
    }

    const { authorization } = event.headers;

    const tokenMatch = BearerRegex.exec(authorization);
    if (!tokenMatch) return { statusCode: 401, headers, body: '' };
    const accessToken = tokenMatch[1];

    const userData = await getUserAppData(accessToken);

    const signedAppData = jwt.sign(userData, DATA_SIGNING_PRIVATE_KEY, {
        algorithm: 'RS256',
        // This sets the validity of the JWT, not necessarily the account. This is
        // how long you can use a paid account offline without talking to the account
        // servers. If the user account expires (needs to renew) before this time,
        // they'll need a new JWT before this deadline anyway. The JWT is generally
        // refreshed every time the app starts and every 10 minutes while it's running.
        expiresIn: '60d',
        audience: 'https://httptoolkit.tech/app_data',
        issuer: 'https://httptoolkit.tech/'
    });

    headers['Content-Type'] = 'application/jwt';

    return {
        statusCode: 200,
        headers,
        body: signedAppData
    };
});