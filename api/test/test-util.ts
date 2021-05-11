import * as path from 'path';
import * as crypto from 'crypto';
import { getLocal } from 'mockttp';
import stoppable from 'stoppable';

import { serveFunctions } from '@httptoolkit/netlify-cli/src/utils/serve-functions';
import { TransactionData } from '../../module/src/types';

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

export const PADDLE_PORT = 9092;
process.env.PADDLE_BASE_URL = `http://localhost:${PADDLE_PORT}`;

export const paddleServer = getLocal({
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

export function givenSubscription(subId: number, userId: number) {
    return paddleServer
        .post(`/api/2.0/subscription/users`)
        .withForm({
            subscription_id: subId.toString()
        })
        .thenJson(200, {
            success: true,
            response: [{ user_id: userId.toString() }]
        });
}

export function givenTransactions(userId: number, transactions: TransactionData[]) {
    return paddleServer
        .post(`/api/2.0/user/${userId}/transactions`)
        .thenJson(200, {
            success: true,
            response: transactions
        });
}

export function freshAuthToken() {
    return crypto.randomBytes(20).toString('hex');
}

const BUILT_FUNCTIONS_DIR = path.join(__dirname, '..', '..', 'dist', 'functions');

export const startServer = async (port = 0) => {
    const { server } = await serveFunctions({
        functionsDir: process.env.FUNCTIONS_DIR || BUILT_FUNCTIONS_DIR,
        quiet: true,
        watch: false,
        port
    });
    return stoppable(server, 0);
};