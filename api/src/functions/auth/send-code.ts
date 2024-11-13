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

    let email;
    try {
        ({ email } = JSON.parse(event.body!));
    } catch (e) {
        throw new StatusError(400, 'Invalid request body');
    }

    if (!email) throw new StatusError(400, 'Email is required');

    await auth0.sendPasswordlessEmail(email);

    return {
        statusCode: 200,
        headers,
        body: ''
    };
});