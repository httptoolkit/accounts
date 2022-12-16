import _ from 'lodash';
import * as path from 'path';
import * as crypto from 'crypto';
import { getLocal } from 'mockttp';
import stoppable from 'stoppable';

import { serveFunctions } from '@httptoolkit/netlify-cli/src/utils/serve-functions';
import { TransactionData } from '../../module/src/types';
import { AppMetadata } from '../src/auth0';

let idCounter = 1000;
export function id() {
    return idCounter++;
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
        .forGet('/api/v2/users-by-email')
        .withQuery({ email })
        .thenJson(200, [
            {
                email: email,
                user_id: userId,
                app_metadata: appMetadata
            }
        ]);
}

export function givenNoUser(email: string) {
    return auth0Server
        .forGet('/api/v2/users-by-email')
        .withQuery({ email })
        .thenJson(200, []);
}

export function givenNoUsers() {
    return auth0Server
        .forGet('/api/v2/users-by-email')
        .thenJson(200, []);
}
export async function givenSubscription(subId: number) {
    const userId = id();

    await paddleServer
        .forPost(`/api/2.0/subscription/users`)
        .withForm({
            subscription_id: subId.toString()
        })
        .thenJson(200, {
            success: true,
            response: [{ user_id: userId.toString() }]
        });

    return { paddleUserId: userId };
}

export function givenTransactions(userId: number, transactions: TransactionData[]) {
    return paddleServer
        .forPost(`/api/2.0/user/${userId}/transactions`)
        .thenJson(200, {
            success: true,
            response: transactions
        });
}

// Create a team, with the given list of users, and 'undefined' for each
// unused license slot that should be created.
export async function givenTeam(
    teamMembersAndSpaces: readonly (
        { id: string, email: string, joinedAt?: number } | undefined
    )[]
) {
    const ownerAuthToken = freshAuthToken();
    const ownerId = "abc";
    const ownerEmail = `billinguser${id()}@example.com`;
    const subExpiry = Date.now();

    let teamMembers = teamMembersAndSpaces.filter(m => !!m) as
        Array<{ id: string, email: string, joinedAt?: number }>;

    // Define the owner in Auth0:
    await auth0Server.forGet('/userinfo')
        .withHeaders({ 'Authorization': 'Bearer ' + ownerAuthToken })
        .thenJson(200, { sub: ownerId });

    let ownerData: AppMetadata = {
        feature_flags: ['a flag'],
        team_member_ids: teamMembers.map(m => m.id),
        locked_licenses: [],
        subscription_expiry: subExpiry,
        subscription_id: 2,
        subscription_quantity: teamMembersAndSpaces.length,
        subscription_plan_id: 550789,
        subscription_status: "active",
        last_receipt_url: 'lru',
        cancel_url: 'cu',
        update_url: 'uu',
    };

    // Return the owner subscription data for the team:
    await auth0Server.forGet('/api/v2/users/' + ownerId)
        .thenCallback(() => ({
            status: 200,
            json: {
                email: ownerEmail,
                app_metadata: ownerData
            }
        }));

    await givenUser(ownerId, ownerEmail, ownerData);

    // Define the team members in Auth0:
    await auth0Server.forGet('/api/v2/users')
        .withQuery({ q: `app_metadata.subscription_owner_id:${ownerId}` })
        .thenCallback(() => ({
            status: 200,
            json: teamMembers.map((member) => ({
                user_id: member.id,
                email: member.email,
                app_metadata: {
                    subscription_owner_id: ownerId,
                    joined_team_at: member.joinedAt ?? new Date(2000, 0, 0).getTime()
                }
            }))
        }));

    // Allow tests to easily update the data returned by the above mocks:
    const updateOwnerData = (update: Partial<AppMetadata>) => {
        ownerData = applyMetadataUpdate(ownerData, update);
    };

    const updateTeamMembers = (
        updatedTeamMembers: Array<{ id: string, email: string, joinedAt?: number }>
    ) => {
        teamMembers = updatedTeamMembers;
    };

    return {
        ownerId,
        ownerEmail,
        ownerAuthToken,
        updateOwnerData,
        updateTeamMembers
    };
};

export function applyMetadataUpdate(data: any, update: any) {
    if (_.isEmpty(update)) return {}; // Empty updates wipe metadata

    return _.omitBy({
        ...data,
        ...update
    }, (_v, key) =>
        update[key] === null // Null values are actually deleted
    );
}

export async function watchUserCreation() {
    let ids: string[] = [];

    const createEndpoint = await auth0Server
        .forPost('/api/v2/users')
        .thenCallback(() => {
            const newUserId = `new-user-${id()}`;
            ids.push(newUserId);
            return {
                status: 200,
                json: {
                    user_id: newUserId
                }
            };
        });

    return async () => {
        const newUsers = await createEndpoint.getSeenRequests();
        return Promise.all(newUsers.map(async (newUser, i) => ({
            url: newUser.url.replace(auth0Server.url, ''),
            body: await newUser.body.getJson() as any,
            id: ids[i]
        })));
    }
}

export async function watchUserUpdates() {
    const updateEndpoint = await auth0Server
        .forPatch(/\/api\/v2\/users\/[^\/]+/)
        .always()
        .thenCallback((req) => {
            const idMatch = req.url.match(/\/([^\/]+)$/);
            return {
                json: {
                    user_id: idMatch![1]
                }
            };
        });

    return async () => {
        const updates = await updateEndpoint.getSeenRequests();
        return Promise.all(updates.map(async (update) => ({
            url: update.url.replace(auth0Server.url, ''),
            body: await update.body.getJson() as any
        })));
    }
}

export async function withUserUpdateNetworkFailures() {
    await auth0Server
        .forPatch(/\/api\/v2\/users\/[^\/]+/)
        .thenCloseConnection();
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