import { Handler, APIGatewayProxyEvent } from 'aws-lambda';
import * as jwt from 'jsonwebtoken';

import { AUTH0_DATA_SIGNING_PRIVATE_KEY, authClient, mgmtClient } from '../auth0';

const BearerRegex = /^Bearer (\S+)$/;

/*
This endpoint expects requests to be sent with a Bearer authorization,
containing a valid access token for the Auth0 app.

If the token is found and is usable, the user's app data (email &
subscription status) are loaded and signed into a JWT, so the app can
read that info, and confirm its validity.
*/
export const handler: Handler = async (event: APIGatewayProxyEvent) => {
    let headers = {
        'Access-Control-Allow-Headers': 'Authorization',
    };

    // Check the origin, include CORS if it's *.httptoolkit.tech
    const { origin } = event.headers;
    let allowedOrigin = /^https?:\/\/(.*\.)httptoolkit.tech(:\d+)?$/.test(origin) ?
        origin : undefined;

    headers['Access-Control-Allow-Origin'] = allowedOrigin;

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    } else if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: '' };
    }

    const { authorization } = event.headers;

    const tokenMatch = BearerRegex.exec(authorization);
    if (!tokenMatch) return { statusCode: 401, headers, body: '' };

    const accessToken = tokenMatch[1];

    // getProfile is only minimal data, updated at last login
    const user: { sub: string } = await authClient.getProfile(accessToken);
    // getUser is full live data for the user
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
}