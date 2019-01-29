import { Handler } from 'aws-lambda';
import * as jwt from 'jsonwebtoken';

const SIGNING_PRIVATE_KEY = `
-----BEGIN RSA PRIVATE KEY-----
${process.env.SIGNING_PRIVATE_KEY}
-----END RSA PRIVATE KEY-----
`;

export const handler: Handler = async (event, context) => {
    const appData = { test: true };

    const signedAppData = jwt.sign(appData, SIGNING_PRIVATE_KEY, {
        algorithm: 'RS256',
        expiresIn: '7d',
        audience: 'https://httptoolkit.tech/app_metadata',
        issuer: 'https://httptoolkit.tech/'
      });

    console.log('Received get subscription request');
    return { statusCode: 200, body: signedAppData };
}