import nodemailer from 'nodemailer';

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

export const mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: true,
    auth: {
        user: SMTP_USERNAME,
        pass: SMTP_PASSWORD
    }
});