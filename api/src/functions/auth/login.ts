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

    let email, code;
    try {
        ({ email, code } = JSON.parse(event.body!));
    } catch (e) {
        throw new StatusError(400, 'Invalid request body');
    }

    if (!email) throw new StatusError(400, 'Email is required');
    if (!code) throw new StatusError(400, 'Code is required');

    const result = await auth0.loginWithPasswordlessCode(email, code, event.requestContext.identity.sourceIp);

    return {
        statusCode: 200,
        headers: { ...headers,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            accessToken: result.access_token,
            refreshToken: result.refresh_token,
            expiresAt: Date.now() + result.expires_in * 1000
        })
    };
});