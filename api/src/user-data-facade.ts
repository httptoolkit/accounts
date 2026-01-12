import _ from 'lodash';
import { sql } from 'kysely';
import log from 'loglevel';
import jwt from 'jsonwebtoken';

import { reportError } from './errors.ts'
import * as auth0 from './auth0.ts';
import { db } from "./db/database.ts";
import { TokenSet } from 'auth0';

// This file wraps the Auth0 APIs, to begin migrating towards DB synchrononization,
// and eventually towards dropping Auth0 entirely. We intentionally closely match the
// Auth0 model for now - we'll go properly relational later.

// For now, we reexport the key Auth0 types:
export type AppMetadata = auth0.AppMetadata;
export type User = {
    user_id: string;
    email: string;
    app_metadata: AppMetadata;
};
export type TrialUserMetadata = auth0.TrialUserMetadata;
export type PayingUserMetadata = auth0.PayingUserMetadata;
export type TeamOwnerMetadata = auth0.TeamOwnerMetadata;
export type TeamMemberMetadata = auth0.TeamMemberMetadata;

export const DATA_SIGNING_PRIVATE_KEY = `
-----BEGIN RSA PRIVATE KEY-----
${process.env.SIGNING_PRIVATE_KEY}
-----END RSA PRIVATE KEY-----
`;

export const LICENSE_LOCK_DURATION_MS = 1000 * 60 * 60 * 24 * 2; // 48h limit on reassigning licenses

export async function updateUserMetadata<A extends AppMetadata>(
    id: string,
    update: {
        [K in keyof A]?: A[K] | null // All optional, can pass null to delete
    }
) {
    const auth0Update = auth0.updateUserMetadata(id, update);

    // Mirror user updates into the DB:
    const dbUpdate = db.updateTable('users')
        .set({
            app_metadata: sql`jsonb_strip_nulls(app_metadata || ${JSON.stringify(update)})`
        })
        .where('auth0_user_id', '=', id)
        .execute()
        .catch((err) => {
            // For now we don't fail in this case, just while we're doing the initial migration
            log.error('Error updating user metadata in DB:', err);
            reportError(err);
        });

    await Promise.all([auth0Update, dbUpdate]);
    return auth0Update;
}

export async function createUser(email: string, appMetadata: AppMetadata = {}) {
    const auth0Creation = await auth0.createUser({
        email,
        connection: 'email',
        email_verified: true, // This ensures users don't receive an email code or verification
        app_metadata: appMetadata
    });

    // Mirror user creation into our DB:
    await createDbUser(auth0Creation.user_id, email, appMetadata)
        .catch((err) => {
            // For now we don't fail in this case, just while we're doing the initial migration
            log.error('Error creating user in DB:', err);
            reportError(err);
        });

    return auth0Creation;
}

function createDbUser(auth0Id: string, email: string, appMetadata: AppMetadata = {}) {
    return db.insertInto('users')
        .values({
            auth0_user_id: auth0Id,
            email,
            app_metadata: appMetadata
        })
        .execute();
}

export async function getOrCreateUser(email: string): Promise<User> {
    const auth0Users = await auth0.getUsersByEmail(email);

    let auth0User: User;
    if (auth0Users.length > 1) {
        throw new Error(`More than one user found for ${email}`);
    } else if (auth0Users.length === 1) {
        auth0User = auth0Users[0];
    } else {
        // Create the user, if they don't already exist:
        auth0User = await createUser(email);
    }

    const dbUsers = await db.selectFrom('users')
        .where('email', '=', email)
        .selectAll()
        .execute();

    if (dbUsers.length === 0) {
        await createDbUser(auth0User.user_id, email, auth0User.app_metadata)
        .catch((err) => {
            // For now we don't fail in this case, just while we're doing the initial migration
            log.error('Error auto-creating user in DB:', err);
            reportError(err);
        });
    } // Can't be >1 since this is unique

    return auth0User;
}

export function getUsersByEmail(email: string) {
    return auth0.getUsersByEmail(email.toLowerCase());
}

export async function getUserById(id: string) {
    const auth0User = await auth0.getUserById(id);

    // Compare Auth0 state to DB, to validate our sync setup:
    const dbUser = await db.selectFrom('users')
        .where('auth0_user_id', '=', id)
        .selectAll()
        .executeTakeFirst();

    if (!auth0User) return auth0User;

    if (!dbUser) {
        reportError(`User ${id} exists in Auth0 but not in DB`);
    }

    if (dbUser?.email !== auth0User.email) {
        reportError(`User ${id} email mismatch between Auth0 (${auth0User.email}) and DB (${dbUser?.email})`);
    }

    if (_.isEqual(dbUser?.app_metadata || {}, auth0User.app_metadata || {}) === false) {
        log.warn('Auth0 app_metadata:', auth0User.app_metadata);
        log.warn('DB app_metadata:', dbUser?.app_metadata);
        log.warn('Diff', getFullDiff(dbUser?.app_metadata || {}, auth0User.app_metadata || {}));
        reportError(`User ${id} app_metadata mismatch between Auth0 and DB`);
    }

    return auth0User;
}

export async function getAuth0UserIdFromToken(token: string) {
    const dbUser = await db.selectFrom('users')
        .selectAll()
        .innerJoin('refresh_tokens', 'users.id', 'refresh_tokens.user_id')
        .innerJoin('access_tokens', 'refresh_tokens.value', 'access_tokens.refresh_token')
        .where('access_tokens.value', '=', token)
        .executeTakeFirst()
        .catch((err) => {
            reportError('Error querying user from token in DB:', err);
            return undefined;
        });

    if (dbUser) {
        return dbUser.auth0_user_id;
    }

    const userInfo = await auth0.getUserInfoFromToken(token);
    return userInfo.sub;
}

export function searchUsers(query: { q: string, per_page: number }) {
    return auth0.searchUsers(query);
}

export function sendPasswordlessCode(email: string, userIp: string) {
    return auth0.sendPasswordlessEmail(email, userIp);
}

export async function loginWithPasswordlessCode(email: string, code: string, userIp: string) {
    const auth0LoginResult = await auth0.loginWithPasswordlessCode(email, code, userIp);
    await pullUserIntoDBFromLogin(auth0LoginResult, userIp);
    return auth0LoginResult;
}

export async function refreshToken(refreshToken: string, userIp: string) {
    const auth0RefreshResult = await auth0.refreshToken(refreshToken, userIp);
    await pullUserIntoDBFromRefresh(refreshToken, auth0RefreshResult, userIp);
    return auth0RefreshResult;
}

// On initial login or token refresh, we pull the user data from Auth0 en route, and migrate it
// into our own DB, so we can start to wean off Auth0:
async function pullUserIntoDBFromLogin(tokens: TokenSet, userIp: string) {
    const idToken = parseAuth0IdToken(tokens.id_token);

    if (idToken?.email && idToken?.auth0Id) {
        await db.insertInto('users')
            .values({
                email: idToken.email,
                auth0_user_id: idToken.auth0Id,
                last_ip: userIp,
                logins_count: 1,
                last_login: new Date(),
                app_metadata: {}
            })
            .onConflict((oc) => oc
                .column('auth0_user_id')
                .doUpdateSet({
                    last_ip: (eb) => eb.ref('excluded.last_ip'),
                    last_login: (eb) => eb.ref('excluded.last_login'),
                    logins_count: sql`COALESCE(users.logins_count, 0) + 1`
                })
            )
            .returning('id')
            .executeTakeFirstOrThrow()
            .then(async (user) => {
                if (!tokens.refresh_token) {
                    throw new Error(`Can't cache non-set refresh token for user ${user.id}`);
                }

                await storeRefreshAndAccessTokens(
                    user.id,
                    tokens.refresh_token,
                    tokens.access_token!,
                    tokens.expires_in!
                );
            })
            .catch((err: any) => {
                // For now we don't fail in this case, just while we're doing the initial migration
                log.error('Error upserting user login info & tokens in DB:', err);
                reportError(err);
            });
    } else {
        console.error('ID token not present or usable on login:', tokens);
        reportError(`Could not parse details from ID token during PWL login for ${tokens.id_token}`);
    }
}

async function pullUserIntoDBFromRefresh(refreshToken: string, refreshResult: TokenSet, userIp: string) {
    try {
        // Insert refresh token, access token & user, if each is not already present. Go from the user down?
        // We need to do a query to get the user data from auth0, if we don't have it already... Awkward.

        if (!refreshResult.access_token) {
            throw new Error('No access token present after refresh');
        }

        const refreshTokenExists = await db.insertInto('access_tokens')
            .values({
                value: refreshResult.access_token,
                refresh_token: refreshToken,
                expires_at: new Date(Date.now() + (refreshResult.expires_in * 1000))
            })
            .execute()
            .then(() => {
                return true;
            }).catch((err: any) => {
                if (err.constraint === 'access_tokens_refresh_token_fkey') {
                    return false;
                } else {
                    throw err;
                }
            });

        if (refreshTokenExists) return; // All done

        // If the refresh token didn't exist, we need to fetch the user data given the access token, and
        // then create the RT to reference it (and maybe create the user too, if required).
        const auth0User = await auth0.getUserInfoFromToken(refreshResult.access_token);
        if (!auth0User?.sub || !auth0User?.email) {
            console.warn(`Returned user data:`, auth0User);
            throw new Error('Could not get user info from access token during refresh');
        }

        // Create user (or just get id) in our DB, in case it doesn't exist:
        const user = await db.insertInto('users')
            .values({
                email: auth0User.email,
                auth0_user_id: auth0User.sub,
                last_ip: userIp,
                logins_count: 1,
                app_metadata: {},
            })
            .onConflict((oc) => oc
                .column('auth0_user_id')
                .doUpdateSet({
                    last_ip: (eb) => eb.ref('excluded.last_ip')
                })
            )
            .returning('id')
            .executeTakeFirstOrThrow();

        // Store the refresh & access tokens again with the full info this time round:
        await storeRefreshAndAccessTokens(
            user.id,
            refreshToken,
            refreshResult.access_token!,
            refreshResult.expires_in!
        );
    } catch (err: any) {
        log.error('Error pulling user into DB during token refresh:', err);
        reportError(err);
    }
}

function parseAuth0IdToken(idToken: string | undefined) {
    try {
        // We get the JWT directly from Auth0 - no need to validate beyond that.
        const idTokenData = jwt.decode(idToken || '');
        return {
            auth0Id: (idTokenData as any)?.sub,
            email: (idTokenData as any)?.email
        };
    } catch (e) {
        console.info('Unreadable id token:', idToken);
        log.error('Error decoding ID token JWT:', e);
    }
}

async function storeRefreshAndAccessTokens(userId: number, refreshToken: string, accessToken: string, expiresIn: number) {
    // Store the tokens we received from Auth0 in our DB:
    await db.insertInto('refresh_tokens').values({
        value: refreshToken,
        user_id: userId,
        last_used: new Date()
    }).execute();

    await db.insertInto('access_tokens').values({
        value: accessToken,
        refresh_token: refreshToken,
        expires_at: new Date(Date.now() + (expiresIn * 1000))
    }).execute();
}

const getFullDiff = (base: any, object: any) => {
  const allKeys = _.union(_.keys(base), _.keys(object));

  return _.reduce(allKeys, (result, key) => {
    if (!_.isEqual(base[key], object[key])) {
      result[key] = { from: base[key], to: object[key] };
    }
    return result;
  }, {} as Record<string, { from: any; to: any }>);
};