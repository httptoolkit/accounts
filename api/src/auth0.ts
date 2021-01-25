import * as auth0 from 'auth0';

const {
    AUTH0_DOMAIN,
    AUTH0_APP_CLIENT_ID,
    AUTH0_MGMT_CLIENT_ID,
    AUTH0_MGMT_CLIENT_SECRET
} = process.env;

export const AUTH0_DATA_SIGNING_PRIVATE_KEY = `
-----BEGIN RSA PRIVATE KEY-----
${process.env.SIGNING_PRIVATE_KEY}
-----END RSA PRIVATE KEY-----
`;

export const authClient = new auth0.AuthenticationClient({
    domain: AUTH0_DOMAIN!,
    clientId: AUTH0_APP_CLIENT_ID
});

export const mgmtClient = new auth0.ManagementClient({
    domain: AUTH0_DOMAIN!,
    clientId: AUTH0_MGMT_CLIENT_ID,
    clientSecret: AUTH0_MGMT_CLIENT_SECRET
});

export type User = auth0.User;