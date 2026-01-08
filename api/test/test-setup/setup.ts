import _ from 'lodash';
import * as path from 'path';
import * as crypto from 'crypto';
import { getLocal } from 'mockttp';
import loglevel from 'loglevel';

import { makeDestroyable } from 'destroyable-server';
export { delay } from '@httptoolkit/util';

import * as auth0 from './auth0.ts';
import { testDB } from './database.ts';
import { generateKeyPair, keyWithoutHeaders } from './utils.ts';

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
process.env.SIGNING_PRIVATE_KEY = keyWithoutHeaders(privateKey as string);

process.env.PAYPRO_IPN_VALIDATION_KEY = PAYPRO_IPN_VALIDATION_KEY;
process.env.SENTRY_DSN = '';
process.env.SMTP_HOST = 'smtp.test';
process.env.SMTP_PORT = '465';
process.env.SMTP_USERNAME = 'user';
process.env.SMTP_PASSWORD = 'pass';
process.env.CONTACT_FORM_DESTINATION = '@';

export const IP_API_PORT = 9093;
process.env.IP_API_BASE_URL = `http://localhost:${IP_API_PORT}`;

export const ipApiServer = getLocal({
    https: {
        keyPath: path.join(import.meta.dirname, '..', 'fixtures', 'test-ca.key'),
        certPath: path.join(import.meta.dirname, '..', 'fixtures', 'test-ca.pem'),
        keyLength: 2048
    }
});


export const EXCHANGE_RATE_API_PORT = 9096;
process.env.EXCHANGE_RATE_BASE_URL = `http://localhost:${EXCHANGE_RATE_API_PORT}`;

export const exchangeRateServer = getLocal({
    https: {
        keyPath: path.join(import.meta.dirname, '..', 'fixtures', 'test-ca.key'),
        certPath: path.join(import.meta.dirname, '..', 'fixtures', 'test-ca.pem'),
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

export async function givenUser(userId: string, email: string, appMetadata: {} | undefined = undefined) {
    const [auth0EndpointMocks] = await Promise.all([
        auth0.givenAuth0User(userId, email, appMetadata),
        testDB.query(`INSERT INTO users (auth0_user_id, email, app_metadata) VALUES ($1, $2, $3)`, [userId, email, appMetadata || {}])
    ]);

    return auth0EndpointMocks;
}

export async function updateUser(userId: string, email: string, appMetadata: {}) {
    const [auth0EndpointMocks] = await Promise.all([
        auth0.givenAuth0User(userId, email, appMetadata),
        testDB.query(`UPDATE users SET app_metadata = $2 WHERE auth0_user_id = $1`, [userId, appMetadata || {}])
    ]);

    return auth0EndpointMocks;
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
    const auth0Team = await auth0.givenAuth0Team(teamMembersAndSpaces);

    // Inefficient loop, but simple and doesn't matter for testing:
    let writes: Array<Promise<any>> = [];
    writes.push(testDB.query(`INSERT INTO users (auth0_user_id, email, app_metadata) VALUES ($1, $2, $3)`, [
        auth0Team.ownerId, auth0Team.ownerEmail, auth0Team.ownerData
    ]));

    for (let member of teamMembersAndSpaces) {
        if (!member) continue;
        writes.push(testDB.query(`INSERT INTO users (auth0_user_id, email, app_metadata) VALUES ($1, $2, $3)`, [
            member.id, member.email, {
                subscription_owner_id: auth0Team.ownerId,
                joined_team_at: member.joinedAt ?? new Date(2000, 0, 0).getTime()
            }
        ]));
    }

    await Promise.all(writes);

    return auth0Team;
};

export const startAPI = async () => {
    // We defer loading the server until the first call to this, to
    // ensure the env vars above are all set first:
    const { startApiServer } = await import('../../src/server.ts');
    const server = await startApiServer();
    return makeDestroyable(server);
}
