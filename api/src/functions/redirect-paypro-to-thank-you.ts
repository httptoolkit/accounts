import { initSentry, catchErrors, reportError } from '../errors';
initSentry();

import * as querystring from 'querystring';

interface PostCheckoutParams {
    ORDER_CUSTOM_FIELDS?: string;
}

export const handler = catchErrors(async (event) => {
    const checkoutData = querystring.parse(event.body || '') as PostCheckoutParams;
    const customParams = new URLSearchParams(checkoutData.ORDER_CUSTOM_FIELDS ?? '');

    let returnUrl = customParams.get('x-return-url');
    if (!returnUrl) {
        reportError('Received paypro-thank-you without a return URL defined', {
            extraMetadata: { checkoutData, headers: event.headers }
        });
        returnUrl = "https://httptoolkit.com/web-purchase-thank-you/";
    } else if (!returnUrl.match(/^https:\/\/httptoolkit.com\/(web|app)-purchase-thank-you/)) {
        reportError(`Received paypro-thank-you with an unrecognized return URL: ${returnUrl}`, {
            extraMetadata: { checkoutData, headers: event.headers }
        });
        returnUrl = "https://httptoolkit.com/web-purchase-thank-you/";
    }

    return {
        statusCode: 302,
        headers: { location: returnUrl },
        body: ''
    };
});