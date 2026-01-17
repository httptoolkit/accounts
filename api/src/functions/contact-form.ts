import _ from 'lodash';
import log from 'loglevel';
import { delay } from '@httptoolkit/util';

import { catchErrors, reportError } from '../errors.ts';
import { getCorsResponseHeaders } from '../cors.ts';
import { sendContactFormEmail } from '../email/mailer.ts';

const THANK_YOU_PAGE = 'https://httptoolkit.com/contact-thank-you/'

export const handler = catchErrors(async (event) => {
    let headers = getCorsResponseHeaders(event);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    } else if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: '' };
    }

    const formData = new URLSearchParams(event.body || '');
    const {
        name,
        email,
        message,
        phone: honeypot
    } = Object.fromEntries(formData);

    if (honeypot) {
        // We can remove this later - just reporting each hit for now to check if it's working
        reportError('Contact form honeypot triggered', {
            extraMetadata: { name, email, message, honeypot }
        });

        // Pretend it did actually work so they don't try again:
        await delay(1000);
        return {
            statusCode: 302,
            headers: {
                Location: THANK_YOU_PAGE
            },
            body: ''
        };
    }

    const fields = [
        ['Name', name],
        ['Email', email],
        ['Message', message]
    ]

    for (let [field, value] of fields) {
        if (!value) {
            return {
                statusCode: 400,
                headers,
                body: `${field} is required`
            };
        }
    }

    await sendContactFormEmail(name, email, message);
    log.info('Sent contract form email from ' + email);

    return {
        statusCode: 302,
        headers: {
            Location: THANK_YOU_PAGE
        },
        body: ''
    };
});