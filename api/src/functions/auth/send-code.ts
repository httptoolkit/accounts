import { initSentry, catchErrors, StatusError } from '../../errors';
initSentry();

import { getCorsResponseHeaders } from '../../cors';
import { sendPasswordlessCode } from '../../user-data-facade';

export const handler = catchErrors(async (event) => {
    let headers = getCorsResponseHeaders(event);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    } else if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: '' };
    }

    let email, source;
    try {
        ({ email, source } = JSON.parse(event.body!));
    } catch (e) {
        throw new StatusError(400, 'Invalid request body');
    }

    if (!email) throw new StatusError(400, 'Email is required');
    if (!source) throw new StatusError(400, 'Source is required');

    await sendPasswordlessCode(email, event.requestContext.identity.sourceIp);

    // N.b. we don't actually use the source yet, but we require it here so we
    // log that later & reset tokens more precisely later, if necessary.

    return {
        statusCode: 200,
        headers,
        body: ''
    };
});