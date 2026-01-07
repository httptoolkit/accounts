import { initSentry, catchErrors, reportError } from '../errors.ts';
initSentry();

import jwt from 'jsonwebtoken';

import { DATA_SIGNING_PRIVATE_KEY } from '../user-data-facade.ts';
import { getCorsResponseHeaders } from '../cors.ts';
import { getUserBillingData } from '../user-data.ts';

const BearerRegex = /^Bearer (\S+)$/;

/*
This endpoint expects requests to be sent with a Bearer authorization,
containing a valid access token for the Auth0 app.

If the token is found and is usable, the user's billing data (email, subscription
status, invoices and team members data) are loaded and signed into a JWT, so the
billing UI can read that info.
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

    try {
        const userData = await getUserBillingData(accessToken);

        const signedAppData = jwt.sign(userData, DATA_SIGNING_PRIVATE_KEY, {
            algorithm: 'RS256',
            expiresIn: '7d',
            audience: 'https://httptoolkit.tech/billing_data',
            issuer: 'https://httptoolkit.tech/'
        });

        headers['Content-Type'] = 'application/jwt';

        return {
            statusCode: 200,
            headers,
            body: signedAppData
        };
    } catch (e: any) {
        await reportError(e);

        return {
            statusCode: e.statusCode ?? 500,
            headers: { ...headers, 'Cache-Control': 'no-store' },
            body: e.message
        }
    }
});