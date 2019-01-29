import { Handler } from 'aws-lambda';
import * as jwt from 'jsonwebtoken';
import * as auth0 from 'auth0';

const {
    AUTH0_DOMAIN,
    AUTH0_APP_CLIENT_ID,
    AUTH0_MGMT_CLIENT_ID,
    AUTH0_MGMT_CLIENT_SECRET
} = process.env;

const SIGNING_PRIVATE_KEY = `
-----BEGIN RSA PRIVATE KEY-----
${process.env.SIGNING_PRIVATE_KEY}
-----END RSA PRIVATE KEY-----
`;

const authClient = new auth0.AuthenticationClient({
    domain: AUTH0_DOMAIN,
    clientId: AUTH0_APP_CLIENT_ID
});

const mgmtClient = new auth0.ManagementClient({
    domain: AUTH0_DOMAIN,
    clientId: AUTH0_MGMT_CLIENT_ID,
    clientSecret: AUTH0_MGMT_CLIENT_SECRET
});

const BearerRegex = /^Bearer (\S+)$/;

export const handler: Handler = async (event, context) => {
    const { authorization } = event.headers;

    const tokenMatch = BearerRegex.exec(authorization);
    if (!tokenMatch) return { status: 401 };

    const accessToken = tokenMatch[1];

    // getProfile is only minimal data, updated at last login
    const user: { sub: string } = await authClient.getProfile(accessToken);
    // getUser is full live data for the user
    const userData = await mgmtClient.getUser({ id: user.sub });

    const appData = Object.assign(
        { email: userData.email },
        userData.app_metadata // undefined, for new users
    );

    const signedAppData = jwt.sign(appData, SIGNING_PRIVATE_KEY, {
        algorithm: 'RS256',
        expiresIn: '7d',
        audience: 'https://httptoolkit.tech/app_metadata',
        issuer: 'https://httptoolkit.tech/'
      });

    return {
        statusCode: 200,
        headers: { 'content-type': 'application/jwt' },
        body: signedAppData
    };
}