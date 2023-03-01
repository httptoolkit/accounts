import { initSentry, catchErrors } from '../errors';
initSentry();

import * as querystring from 'querystring';

export const handler = catchErrors(async (event) => {
    const payProData = querystring.parse(event.body || '') as unknown;
    console.log('Received PayPro webhook', JSON.stringify(payProData));
    return { statusCode: 500, body: 'Not yet implemented' };
});