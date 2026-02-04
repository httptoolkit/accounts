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

    // We get some spam with random strings (SMSINiyNSHbJXPwUTmR). Single word messages
    // are not plausibly real/meaningful contact messages, so just treat them as spam.
    const isRandomSpamMessage = message.length > 10 && message.length < 30 && !message.trim().includes(' ');

    if (honeypot || isRandomSpamMessage) {
        // We can remove this later - just reporting each hit for now to check if it's working
        reportError(
            honeypot
                ? 'Contact form honeypot triggered'
                : 'Spam message received',
            {
                extraMetadata: {
                    name,
                    email,
                    message,
                    honeypot,
                    ip: event.requestContext?.identity.sourceIp
                }
            }
        );

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