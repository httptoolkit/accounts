import * as auth0 from "./auth0";

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
    return auth0.updateUserMetadata(id, update);
}

export async function createUser(email: string, appMetadata: AppMetadata = {}) {
    return auth0.createUser({
        email,
        connection: 'email',
        email_verified: true, // This ensures users don't receive an email code or verification
        app_metadata: appMetadata
    });
}

export function getUsersByEmail(email: string) {
    return auth0.getUsersByEmail(email);
}

export function getUserById(id: string) {
    return auth0.getUserById(id);
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

export function loginWithPasswordlessCode(email: string, code: string, userIp: string) {
    return auth0.loginWithPasswordlessCode(email, code, userIp);
}

export function refreshToken(refreshToken: string, userIp: string) {
    return auth0.refreshToken(refreshToken, userIp);
}