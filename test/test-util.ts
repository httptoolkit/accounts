import * as path from 'path';
import * as crypto from 'crypto';
import { getLocal } from 'mockttp';
import stoppable from 'stoppable';

import { serveFunctions } from '@httptoolkit/netlify-cli/src/utils/serve-functions';

function generateKeyPair() {
    return crypto.generateKeyPairSync('rsa', {
        modulusLength: 512,
        privateKeyEncoding: {
            type: "pkcs1",
            format: 'pem'
        } as any,
        publicKeyEncoding: {
            type: "spki",
            format: 'pem'
        }
    });
}

export const {
    privateKey,
    publicKey
} = generateKeyPair();

const keyWithoutHeaders = (key: string) => key.split('\n').slice(1, -2).join('\n');

// We generate one key, then use it for both paddle webhook signing and our own
// /get-app-data data signing, because we're lazy like that. It's good enough though.
process.env.PADDLE_PUBLIC_KEY = keyWithoutHeaders(publicKey);
process.env.SIGNING_PRIVATE_KEY = keyWithoutHeaders(privateKey);

export const AUTH0_PORT = 9091;
process.env.AUTH0_DOMAIN = `localhost:${AUTH0_PORT}`;
process.env.AUTH0_APP_CLIENT_ID = 'auth0-id';
process.env.AUTH0_APP_CLIENT_SECRET = undefined;
process.env.AUTH0_MGMT_CLIENT_ID = 'auth0-mgmt-id';
process.env.AUTH0_MGMT_CLIENT_SECRET = 'auth0-mgmt-secret';
process.env.SENTRY_DSN = '';

export const auth0Server = getLocal({
    https: {
        keyPath: path.join(__dirname, 'fixtures', 'test-ca.key'),
        certPath: path.join(__dirname, 'fixtures', 'test-ca.pem'),
        keyLength: 2048
    }
});

export function givenUser(userId: string, email: string, appMetadata = {}) {
    return auth0Server
        .get('/api/v2/users-by-email')
        .withQuery({ email })
        .thenJson(200, [
            {
                email: email,
                user_id: userId,
                app_metadata: appMetadata
            }
        ]);
}

export function givenNoUsers() {
    return auth0Server
        .get('/api/v2/users-by-email')
        .thenJson(200, []);
}

export function freshAuthToken() {
    return crypto.randomBytes(20).toString('hex');
}

export const startServer = async (port = 0) => {
    const { server } = await serveFunctions({
        functionsDir: process.env.FUNCTIONS_DIR || path.join(__dirname, '..', 'functions'),
        quiet: true,
        watch: false,
        port
    });
    return stoppable(server, 0);
};