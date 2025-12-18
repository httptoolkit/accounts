import { initSentry, catchErrors, StatusError } from '../../errors';
initSentry();

import { getCorsResponseHeaders } from '../../cors';
import * as auth0 from '../../auth0';

export const handler = catchErrors(async (event) => {
    let headers = getCorsResponseHeaders(event);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    } else if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: '' };
    }

    let refreshToken;
    try {
        ({ refreshToken } = JSON.parse(event.body!));
    } catch (e) {
        throw new StatusError(400, 'Invalid request body');
    }

    if (!refreshToken) throw new StatusError(400, 'Refresh token is required');

    const result = await auth0.refreshToken(refreshToken, event.requestContext.identity.sourceIp);

    return {
        statusCode: 200,
        headers: { ...headers,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            accessToken: result.access_token,
            expiresAt: Date.now() + result.expires_in * 1000
        })
    };
});