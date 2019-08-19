import { initSentry, catchErrors } from '../errors';
initSentry();

import { APIGatewayProxyEvent } from 'aws-lambda';
import * as jwt from 'jsonwebtoken';

import { AUTH0_DATA_SIGNING_PRIVATE_KEY, authClient, mgmtClient } from '../auth0';

const BearerRegex = /^Bearer (\S+)$/;

const ONE_DAY_IN_SECONDS = 60 * 60 * 24;

/*
This endpoint expects requests to be sent with a Bearer authorization,
containing a valid access token for the Auth0 app.

If the token is found and is usable, the user's app data (email, subscription
status & feature flags) are loaded and signed into a JWT, so the app can
read that info, and confirm its validity.
*/
export const handler = catchErrors(async (event: APIGatewayProxyEvent) => {
    let headers = {
        'Access-Control-Allow-Headers': 'Authorization',
        'Access-Control-Max-Age': ONE_DAY_IN_SECONDS.toString(), // Chrome will cache for 10 mins max anyway

        // Cache OPTIONS responses for ages, cache others only briefly
        'Cache-Control':
            event.httpMethod === 'OPTIONS'
                ? 'public, max-age=' + ONE_DAY_IN_SECONDS // The OPTIONS result is effectively constant - cache for 24h
                : 'private, max-age=10', // Briefly cache, just to avoid completely unnecessary calls
        'Vary': 'Authorization'
    };

    // Check the origin, include CORS if it's *.httptoolkit.tech
    const { origin } = event.headers;
    let allowedOrigin = /^https?:\/\/(.*\.)?httptoolkit.tech(:\d+)?$/.test(origin) ?
        origin : undefined;

    if (allowedOrigin) {
        headers['Access-Control-Allow-Origin'] = allowedOrigin;
    } else if (origin) {
        console.warn('CORS request from invalid origin!', origin);
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

    // getProfile is only minimal data, updated at last login (/userinfo - 5 req/minute/user)
    const user: { sub: string } = await authClient.getProfile(accessToken);
    // getUser is full live data for the user (/users/{id} - 15 req/second)
    const userData = await mgmtClient.getUser({ id: user.sub });

    const appData = Object.assign(
        { email: userData.email },
        userData.app_metadata // undefined, for new users
    );

    const signedAppData = jwt.sign(appData, AUTH0_DATA_SIGNING_PRIVATE_KEY, {
        algorithm: 'RS256',
        expiresIn: '7d',
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