import _ from 'lodash';
import * as path from 'path';
import * as crypto from 'crypto';
import { getLocal } from 'mockttp';
import * as loglevel from 'loglevel';

import { makeDestroyable } from 'destroyable-server';
export { delay } from "@httptoolkit/util";

import * as auth0 from './auth0';
import { generateKeyPair, keyWithoutHeaders } from './utils';

// We don't need log/debug info in the tests most of the time:
loglevel.setLevel('warn');

// Set up self-managing mocks:
import './profitwell';
import './database';

export const {
    privateKey,
    publicKey
} = generateKeyPair();

export const PAYPRO_IPN_VALIDATION_KEY = 'test_key_123';

// We generate one key, then use it for both paddle webhook signing and our own
// /get-app-data data signing, because we're lazy like that. It's good enough though.
process.env.PADDLE_PUBLIC_KEY = keyWithoutHeaders(publicKey);
process.env.SIGNING_PRIVATE_KEY = keyWithoutHeaders(privateKey);

process.env.PAYPRO_IPN_VALIDATION_KEY = PAYPRO_IPN_VALIDATION_KEY;
process.env.SENTRY_DSN = '';

export const IP_API_PORT = 9093;
process.env.IP_API_BASE_URL = `http://localhost:${IP_API_PORT}`;

export const ipApiServer = getLocal({
    https: {
        keyPath: path.join(__dirname, '..', 'fixtures', 'test-ca.key'),
        certPath: path.join(__dirname, '..', 'fixtures', 'test-ca.pem'),
        keyLength: 2048
    }
});


export const EXCHANGE_RATE_API_PORT = 9096;
process.env.EXCHANGE_RATE_BASE_URL = `http://localhost:${EXCHANGE_RATE_API_PORT}`;

export const exchangeRateServer = getLocal({
    https: {
        keyPath: path.join(__dirname, '..', 'fixtures', 'test-ca.key'),
        certPath: path.join(__dirname, '..', 'fixtures', 'test-ca.pem'),
        keyLength: 2048
    }
});

export function givenExchangeRate(currency: string, rate: number) {
    return exchangeRateServer.forGet('/latest/EUR')
        .thenJson(200, {
            result: 'success',
            conversion_rates: {
                [currency]: rate
            }
        })
}

export function givenUser(userId: string, email: string, appMetadata: {} | undefined = undefined) {
    return auth0.givenAuth0User(userId, email, appMetadata);
}

export function givenNoUser(email: string) {
    return auth0.givenNoAuth0User(email);
}

export function givenNoUsers() {
    return auth0.givenNoAuth0Users();
}

export function freshAuthToken() {
    return crypto.randomBytes(20).toString('hex');
}

export function givenAuthToken(authToken: string, userId: string) {
    return auth0.givenAuth0Token(authToken, userId);
}

// Create a team, with the given list of users, and 'undefined' for each
// unused license slot that should be created.
export async function givenTeam(
    teamMembersAndSpaces: readonly (
        { id: string, email: string, joinedAt?: number } | undefined
    )[]
) {
    return auth0.givenAuth0Team(teamMembersAndSpaces);
};

export const startAPI = async () => {
    // We defer loading the server until the first call to this, to
    // ensure the env vars above are all set first:
    const { startApiServer } = await import('../../src/server');
    const server = await startApiServer();
    return makeDestroyable(server);
}