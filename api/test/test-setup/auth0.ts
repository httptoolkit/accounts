import _ from 'lodash';
import * as path from 'path';
import { getLocal, RulePriority } from 'mockttp';

import { AppMetadata } from '../../src/user-data-facade.ts';

import { id } from './utils.ts';
import{ freshAuthToken, publicKey } from './setup.ts';
import { createPublicKey } from 'crypto';

export const AUTH0_PORT = 9091;
process.env.AUTH0_DOMAIN = `localhost:${AUTH0_PORT}`;
process.env.AUTH0_APP_CLIENT_ID = 'auth-client-id';
process.env.AUTH0_APP_CLIENT_SECRET = 'auth-client-secret';
process.env.AUTH0_MGMT_CLIENT_ID = 'auth0-mgmt-id';
process.env.AUTH0_MGMT_CLIENT_SECRET = 'auth0-mgmt-secret';

export const auth0Server = getLocal({
    https: {
        keyPath: path.join(import.meta.dirname, '..', 'fixtures', 'test-ca.key'),
        certPath: path.join(import.meta.dirname, '..', 'fixtures', 'test-ca.pem'),
        keyLength: 2048
    }
});

export function givenAuth0User(userId: string, email: string, appMetadata: {} | undefined = undefined) {
    return Promise.all([
        auth0Server
        .forGet(`/api/v2/users/${userId}`)
        .thenJson(200, {
            email: email,
            user_id: userId,
            app_metadata: appMetadata
        }),
        auth0Server
        .forGet('/api/v2/users-by-email')
        .withQuery({ email })
        .thenJson(200, [
            {
                email: email,
                user_id: userId,
                app_metadata: appMetadata
            }
        ]),
    ]);
}

export function givenNoAuth0User(email: string) {
    return auth0Server
        .forGet('/api/v2/users-by-email')
        .withQuery({ email })
        .thenJson(200, []);
}

export function givenNoAuth0Users() {
    return auth0Server
        .forGet('/api/v2/users-by-email')
        .thenJson(200, []);
}

export function givenAuth0Token(authToken: string, userId: string) {
    return auth0Server.forGet('/userinfo')
        .withHeaders({ 'Authorization': 'Bearer ' + authToken })
        .thenJson(200, { sub: userId });
}

export async function withAuth0UserUpdateNetworkFailures() {
    return auth0Server
        .forPatch(/\/api\/v2\/users\/[^\/]+/)
        .thenCloseConnection();
}

export async function watchAuth0UserCreation() {
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

export async function watchAuth0UserUpdates() {
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

// Create a team, with the given list of users, and 'undefined' for each
// unused license slot that should be created.
export async function givenAuth0Team(
    teamMembersAndSpaces: readonly (
        { id: string, email: string, joinedAt?: number } | undefined
    )[]
) {
    const ownerAuthToken = freshAuthToken();
    const ownerId = "abc";
    const ownerEmail = `billinguser${id()}@example.com`;
    const subExpiry = Date.now() + 60_000;

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
        payment_provider: 'paddle',
        subscription_expiry: subExpiry,
        subscription_id: '2',
        subscription_quantity: teamMembersAndSpaces.length,
        subscription_plan_id: 550789,
        subscription_status: "active",
        last_receipt_url: 'lru',
        cancel_url: 'cu',
        update_url: 'uu',
    };

    // Return the owner subscription data for the team:
    await auth0Server.forGet('/api/v2/users/' + ownerId)
        .always()
        .thenCallback(() => ({
            status: 200,
            json: {
                email: ownerEmail,
                app_metadata: ownerData
            }
        }));

    await givenAuth0User(ownerId, ownerEmail, ownerData);

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
        ownerData = applyAuth0MetadataUpdate(ownerData, update);
    };

    const updateTeamMembers = (
        updatedTeamMembers: Array<{ id: string, email: string, joinedAt?: number }>
    ) => {
        teamMembers = updatedTeamMembers;
    };

    return {
        ownerId,
        ownerEmail,
        ownerData,
        ownerAuthToken,
        updateOwnerData,
        updateTeamMembers
    };
};

export function applyAuth0MetadataUpdate(data: any, update: any) {
    if (_.isEmpty(update)) return {}; // Empty updates wipe metadata

    return _.omitBy({
        ...data,
        ...update
    }, (_v, key) =>
        update[key] === null // Null values are actually deleted
    );
}

beforeEach(async () => {
    await auth0Server.start(AUTH0_PORT);
    await auth0Server
        .forPost('/oauth/token')
        .asPriority(RulePriority.FALLBACK)
        .thenJson(200, {});

    await auth0Server
        .forGet('/.well-known/jwks.json')
        .asPriority(RulePriority.FALLBACK)
        .thenJson(200, {
            keys: [{
                ...createPublicKey(publicKey).export({ format: 'jwk' }),
                use: 'sig',
                alg: 'RS256',
                kid: 'test-key'
            }]
        });
});

afterEach(async () => {
    await auth0Server.stop();
});