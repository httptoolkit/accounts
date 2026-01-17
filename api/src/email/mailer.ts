import log from 'loglevel';
import * as path from 'path';
import * as fs from 'fs';

import nodemailer from 'nodemailer';
import cssInline from '@css-inline/css-inline';
import Handlebars from 'handlebars';

const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USERNAME,
    SMTP_PASSWORD
} = process.env;

if (!SMTP_HOST) throw new Error('No SMTP host configured');
if (!SMTP_PORT) throw new Error('No SMTP port configured');
if (!SMTP_USERNAME) throw new Error('No SMTP user configured');
if (!SMTP_PASSWORD) throw new Error('No SMTP password configured');

const { CONTACT_FORM_DESTINATION } = process.env;
if (!CONTACT_FORM_DESTINATION) throw new Error('No contact form destination configured');

const TEMPLATES_DIR = import.meta.dirname;

const buildContactFormEmail = Handlebars.compile(
    fs.readFileSync(path.join(TEMPLATES_DIR, 'contact-form.html'), 'utf8')
);

const THEME = {
    light: {
        containerBackground:    "#e4e8ed",
        mainBackground:         "#fafafa",
        mainLowlightBackground: "#f2f2f2",
        mainLowlightColor:      "#53565e",
        mainColor:              "#1e2028",
        containerBorder:        "#9a9da8"
    },
    dark: {
        containerBackground:    "#1e2028",
        mainBackground:         "#32343B",
        mainLowlightBackground: "#25262e",
        mainLowlightColor:      "#818490",
        mainColor:              "#ffffff",
        containerBorder:        "#000000"
    }
};

const mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: true,
    auth: {
        user: SMTP_USERNAME,
        pass: SMTP_PASSWORD
    }
});

export async function testEmailConnection() {
    try {
        await mailer.verify();
        log.info('SMTP transporter verified');
    } catch (e: any) {
        log.error(e);
        throw new Error(`Error verifying SMTP connection: ${e.message || e}`);
    }
}

export function sendContactFormEmail(name: string, email: string, message: string) {
    const html = buildContactFormEmail({
        summary: message,
        name,
        email,
        message
    });

    return mailer.sendMail({
        from: 'Contact form <contact-form@httptoolkit.com>',
        to: CONTACT_FORM_DESTINATION,
        replyTo: email,
        subject: 'HTTP Toolkit contact form message',
        html: cssInline.inline(html, { keepStyleTags: true })
    });
}