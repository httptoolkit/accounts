import _ from 'lodash';
import { sql } from 'kysely';
import log from 'loglevel';

import { reportError } from './errors.ts'
import * as auth0 from './auth0.ts';
import { db } from "./db/database.ts";

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
            app_metadata: sql`app_metadata || ${JSON.stringify(update)}`
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
    return auth0.getUsersByEmail(email);
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

export function getUserInfoFromToken(token: string) {
    return auth0.getUserInfoFromToken(token);
}

export function searchUsers(query: { q: string, per_page: number }) {
    return auth0.searchUsers(query);
}

export function sendPasswordlessCode(email: string, userIp: string) {
    return auth0.sendPasswordlessEmail(email, userIp);
}

export async function loginWithPasswordlessCode(email: string, code: string, userIp: string) {
    await db.updateTable('users')
        .set({
            last_ip: userIp,
            logins_count: sql`COALESCE(logins_count, 0) + 1`,
            last_login: new Date()
        })
        .where('email', '=', email)
        .execute()
        .catch((err) => {
            // For now we don't fail in this case, just while we're doing the initial migration
            log.error('Error updating user login info in DB:', err);
            reportError(err);
        });

    return auth0.loginWithPasswordlessCode(email, code, userIp);
}

export function refreshToken(refreshToken: string, userIp: string) {
    return auth0.refreshToken(refreshToken, userIp);
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