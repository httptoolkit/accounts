import _ from 'lodash';
import { QueryCreator, sql } from 'kysely';
import log from 'loglevel';
import { randomBytes, randomInt } from 'crypto';
import { TokenSet } from 'auth0';

import { reportError, StatusError } from './errors.ts'
import * as auth0 from './auth0.ts';
import { db } from "./db/database.ts";
import { Database } from './db/schema.ts';
import * as mailer from './email/mailer.ts';

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
        // This can happen sometime for fresh auth0 logins via an old
        // UI & Auth0 widget that doesn't login through the API, but that
        // should be the only (and rare) case.
        if (!_.isEmpty(auth0User.app_metadata)) {
            reportError(`User ${id} with data exists in Auth0 but not in DB`);
        }

        return auth0User;
    }

    if (dbUser?.email.toLowerCase() !== auth0User.email.toLowerCase()) {
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
        .where('access_tokens.expires_at', '>=', new Date())
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

const PASSWORDLESS_CODE_DURATION = 60 * 60 * 1000;

export async function sendPasswordlessCode(email: string, userIp: string) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    await db.transaction().execute(async (trx) => {
        // We use the # of existing codes to rate limit this - no more than 3 per hour:
        const existingCodes = await trx.selectFrom('login_tokens')
            .where('email', '=', email)
            .where('created_at', '>=', new Date(Date.now() - 60 * 60 * 1000))
            .selectAll()
            .execute();

        if (existingCodes.length >= 3) {
            throw new StatusError(429, 'Too many codes requested - please try again later');
        }

        await trx.insertInto('login_tokens')
            .values({
                email,
                user_ip: userIp,
                value: code,
                expires_at: new Date(Date.now() + PASSWORDLESS_CODE_DURATION)
            })
            .execute();

        await mailer.sendLoginCodeEmail(email, code);
    });
}

const ATTEMPTS_LIMIT = 5;

export async function loginWithPasswordlessCode(email: string, code: string, userIp: string) {
    // We intentionally compare to all currently valid codes - to avoid issues with repeated
    // code requests (users do this relatively often due to email delivery delay etc).
    const existingCodes = await db.selectFrom('login_tokens')
        .where('email', '=', email)
        .where('expires_at', '>', new Date())
        .selectAll()
        .execute();

    const overusedCode = !!existingCodes.find(c => c.attempts >= ATTEMPTS_LIMIT);
    const matchingCode = !overusedCode && !!existingCodes.find(c => c.value === code);

    if (!matchingCode || overusedCode) {
        if (existingCodes.length) {
            // Increment attempts for all existing codes for this email:
            await db.updateTable('login_tokens')
                .set({
                    attempts: sql`attempts + 1`
                })
                .where('email', '=', email)
                .where('id', 'in', existingCodes.map(c => c.id))
                .execute();
        }

        if (overusedCode) {
            throw new StatusError(429, 'Too many login attempts - please try again later');
        } else {
            throw new StatusError(403, 'Invalid or expired login code');
        }
    }

    await db.deleteFrom('login_tokens')
        .where('value', '=', code)
        .execute();

    let auth0User = await auth0.getUsersByEmail(email).then(users => users[0]);
    if (!auth0User) {
        auth0User = await auth0.createUser({
            email,
            connection: 'email',
            email_verified: true, // This ensures users don't receive an email code or verification
            app_metadata: {}
        });
    }

    // Create the user at this point, if they don't already exist:
    const user = await db.insertInto('users')
        .values({
            email: email,
            auth0_user_id: auth0User.user_id,
            last_ip: userIp,
            last_login: new Date(),
            logins_count: 1,
            app_metadata: {},
        })
        .onConflict((oc) => oc
            .column('email')
            .doUpdateSet({
                last_ip: (eb) => eb.ref('excluded.last_ip'),
                last_login: (eb) => eb.ref('excluded.last_login'),
                logins_count: sql`COALESCE(users.logins_count, 0) + 1`
            })
        )
        .returning('id')
        .executeTakeFirstOrThrow();

    // And issue them a refresh & access token for this session:
    const newRefreshToken = `rt-${randomBytes(32).toString('hex')}`;

    const newAccessToken = `at-${randomBytes(32).toString('hex')}`;
    const expiresAt = Date.now() + (1000 * 60 * 60 * 24);

    await db.insertInto('refresh_tokens')
        .values({
            user_id: user.id,
            value: newRefreshToken
        })
        .execute();

    await db.insertInto('access_tokens')
        .values({
            value: newAccessToken,
            refresh_token: newRefreshToken,
            expires_at: new Date(expiresAt)
        })
        .execute();

    return {
        refreshToken: newRefreshToken,
        accessToken: newAccessToken,
        expiresAt
    };
}

export async function refreshToken(refreshToken: string, userIp: string) {
    // If we're already in the DB, we skip Auth0 entirely:
    if (await doesRefreshTokenExist(db, refreshToken)) {
        const newAccessToken = `at-${randomBytes(32).toString('hex')}`;
        const expiresAt = Date.now() + (1000 * 60 * 60 * 24);

        await Promise.all([
            db.insertInto('access_tokens')
                .values({
                    value: newAccessToken,
                    refresh_token: refreshToken,
                    expires_at: new Date(expiresAt)
                })
                .execute(),
            db.updateTable('refresh_tokens')
                .set({
                    last_used: new Date()
                })
                .where('value', '=', refreshToken)
                .execute()
        ]);

        return {
            accessToken: newAccessToken,
            expiresAt
        };
    } else {
        // If not, we go to Auth0 as before, and then cache the result:
        const auth0RefreshResult = await auth0.refreshToken(refreshToken, userIp);
        await pullUserIntoDBFromRefresh(db, refreshToken, auth0RefreshResult, userIp);
        return {
            accessToken: auth0RefreshResult.access_token!,
            expiresAt: Date.now() + auth0RefreshResult.expires_in! * 1000
        };
    }
}

async function doesRefreshTokenExist(db: QueryCreator<Database>, refreshToken: string) {
    const rt = await db.selectFrom('refresh_tokens')
        .where('value', '=', refreshToken)
        .selectAll()
        .executeTakeFirst();
    return !!rt;
}

async function pullUserIntoDBFromRefresh(db: QueryCreator<Database>, refreshToken: string, refreshResult: TokenSet, userIp: string) {
    try {
        // Insert refresh token, access token & user, if each is not already present. Go from the user down?
        // We need to do a query to get the user data from auth0, if we don't have it already... Awkward.

        if (!refreshResult.access_token) {
            throw new Error('No access token present after refresh');
        }

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
            db,
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

async function storeRefreshAndAccessTokens(
    db: QueryCreator<Database>,
    userId: number,
    refreshToken: string,
    accessToken: string,
    expiresIn: number
) {
    // Store the tokens we received from Auth0 in our DB:
    await db.insertInto('refresh_tokens')
        .values({
            value: refreshToken,
            user_id: userId,
            last_used: new Date()
        })
        // Conflicts can happen given parallel refresh attempts, not a big deal.
        .onConflict((oc) => oc
            .column('value')
            .doUpdateSet({
                last_used: new Date()
            })
        )
        .execute();

    await db.insertInto('access_tokens')
        .values({
            value: accessToken,
            refresh_token: refreshToken,
            expires_at: new Date(Date.now() + (expiresIn * 1000))
        })
        .execute();
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