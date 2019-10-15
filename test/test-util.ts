import * as path from 'path';
import * as crypto from 'crypto';
import { getLocal } from 'mockttp';
import stoppable from 'stoppable';

import { serveFunctions } from 'netlify-cli/src/utils/serve-functions';

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
    privateKey: paddlePrivateKey,
    publicKey: paddlePublicKey
} = generateKeyPair();
process.env.PADDLE_PUBLIC_KEY = paddlePublicKey.split('\n').slice(1, -2).join('\n');

export const AUTH0_PORT = 9091;
process.env.AUTH0_DOMAIN = `localhost:${AUTH0_PORT}`;
process.env.AUTH0_APP_CLIENT_ID = 'auth0-id';
process.env.AUTH0_MGMT_CLIENT_ID = 'auth0-mgmt-id';
process.env.AUTH0_MGMT_CLIENT_SECRET = 'auth0-mgmt-secret';

export const auth0Server = getLocal({
    https: {
        keyPath: path.join(__dirname, 'fixtures', 'test-ca.key'),
        certPath: path.join(__dirname, 'fixtures', 'test-ca.pem'),
    }
});

export function givenUser(userId: number, email: string, appMetadata = {}) {
    return auth0Server
        .get('/api/v2/users-by-email')
        .withQuery({ email })
        .thenReply(200, JSON.stringify([
            {
                email: email,
                user_id: userId,
                app_metadata: appMetadata
            }
        ]), {
            "content-type": 'application/json'
        });
}

export function givenNoUsers() {
    return auth0Server
        .get('/api/v2/users-by-email')
        .thenReply(200, JSON.stringify([]), {
            "content-type": 'application/json'
        });
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