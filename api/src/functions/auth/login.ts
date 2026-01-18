import { initSentry, catchErrors, StatusError } from '../../errors.ts';
initSentry();

import { getCorsResponseHeaders } from '../../cors.ts';
import { loginWithPasswordlessCode } from '../../user-data-facade.ts';

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

    const result = await loginWithPasswordlessCode(email, code, event.requestContext.identity.sourceIp);

    return {
        statusCode: 200,
        headers: { ...headers,
            'content-type': 'application/json'
        },
        body: JSON.stringify(result)
    };
});