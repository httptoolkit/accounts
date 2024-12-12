import nodemailer from 'nodemailer';

import { catchErrors, reportError } from '../errors';
import { delay } from '@httptoolkit/util';
import { getCorsResponseHeaders } from '../cors';

const {
    CONTACT_FORM_DESTINATION,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USERNAME,
    SMTP_PASSWORD
} = process.env;

if (!CONTACT_FORM_DESTINATION) throw new Error('No contact form destination configured');

if (!SMTP_HOST) throw new Error('No SMTP host configured');
if (!SMTP_PORT) throw new Error('No SMTP port configured');
if (!SMTP_USERNAME) throw new Error('No SMTP user configured');
if (!SMTP_PASSWORD) throw new Error('No SMTP password configured');

const mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: true,
    auth: {
        user: SMTP_USERNAME,
        pass: SMTP_PASSWORD
    }
});

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

    fields.forEach(([field, value]) => {
        if (!value) {
            return {
                statusCode: 400,
                headers,
                body: `${field} is required`
            };
        }
    });

    await mailer.sendMail({
        from: 'Contact form <contact-form@httptoolkit.com>',
        to: CONTACT_FORM_DESTINATION,
        replyTo: email,
        subject: 'HTTP Toolkit contact form message',
        html: `<html><style>p { margin-bottom: 10px; }</style><body>
        ${
            fields.map(([field, value]) => {
                return `<p><strong>${field}</strong>:<br/>${value}</p>`;
            }).join('')
        }</body></html>`
    });

    return {
        statusCode: 302,
        headers: {
            Location: THANK_YOU_PAGE
        },
        body: ''
    };
});