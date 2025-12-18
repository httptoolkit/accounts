import * as auth0 from 'auth0';
import { SubscriptionStatus, SKU } from '@httptoolkit/accounts';

import { withRetries } from './retries';
import { StatusError } from './errors';

const {
    AUTH0_DOMAIN,
    AUTH0_MGMT_CLIENT_ID,
    AUTH0_MGMT_CLIENT_SECRET,
    AUTH0_APP_CLIENT_ID,
    AUTH0_APP_CLIENT_SECRET
} = process.env;

export const AUTH0_DATA_SIGNING_PRIVATE_KEY = `
-----BEGIN RSA PRIVATE KEY-----
${process.env.SIGNING_PRIVATE_KEY}
-----END RSA PRIVATE KEY-----
`;

const userInfoClient = new auth0.UserInfoClient({
    domain: AUTH0_DOMAIN!
});

// Querying user info by token returns minimal data, updated at last login (RL @ 5 req/minute/user)
export const getUserInfoFromToken = withRetries('getUserInfoFromToken', async (accessToken: string) =>
    (await userInfoClient.getUserInfo(accessToken)).data,
    {
        shouldThrow: (e) => {
            // Don't retry 401 errors - return a 401 status immediately.
            if (e?.statusCode === 401) {
                return new StatusError(401, "Unauthorized")
            } else return undefined;
        }
    }
);

const mgmtClient = new auth0.ManagementClient({
    domain: AUTH0_DOMAIN!,
    clientId: AUTH0_MGMT_CLIENT_ID!,
    clientSecret: AUTH0_MGMT_CLIENT_SECRET!
});

// All the below returns full live data for the user (RL @ 500 req/minute total, 40/s bursts)
export const getUserById = withRetries('getUserById', async (userId: string) =>
    (await mgmtClient.users.get({ id: userId })).data as User
);

export const getUsersByEmail = withRetries('getUsersByEmail', async (email: string) =>
    (await mgmtClient.usersByEmail.getByEmail({ email })).data as User[]
);

export const searchUsers = withRetries('searchUsers', async (query: auth0.GetUsersRequest) =>
    (await mgmtClient.users.getAll(query)).data as User[]
);

// Updating the user has RL @ 200/minute total (20/s bursts)
export const updateUserMetadata = withRetries('updateUserMetadata', async <A extends AppMetadata>(
    id: string,
    update: {
        [K in keyof A]?: A[K] | null // All optional, can pass null to delete
    }
) =>
    (await mgmtClient.users.update({ id }, { app_metadata: update })).data as User
);

export const createUser = withRetries('createUser', async (parameters: auth0.UserCreate) =>
    (await mgmtClient.users.create(parameters)).data as User
);

const authClient = new auth0.AuthenticationClient({
    domain: AUTH0_DOMAIN!,
    clientId: AUTH0_APP_CLIENT_ID!,
    clientSecret: AUTH0_APP_CLIENT_SECRET!
});

const withUserIpHeader = (userIp: string) =>
    async ({ init }: { init: RequestInit }) => ({
        headers: {
            ...init.headers,
            'auth0-forwarded-for': userIp
        }
    });

export const sendPasswordlessEmail = withRetries('sendPWLEmail', async (email: string, userIp: string) =>
    await authClient.passwordless.sendEmail({
        email,
        send: 'code'
    }, withUserIpHeader(userIp))
);

export const loginWithPasswordlessCode = withRetries('loginPWL', async (email: string, code: string, userIp: string) =>
    (await authClient.passwordless.loginWithEmail({
        email: email,
        code: code,
        scope: 'email openid offline_access app_metadata'
    }, {
        initOverrides: withUserIpHeader(userIp)
    })).data,
    {
        shouldThrow: (e) => {
            console.log(`PWL login failed with status ${e.statusCode}: ${e.message}`);

            if (e?.statusCode === 403) {
                // Don't retry hard authentication failures - return them explicitly
                return new StatusError(403, "Login failed")
            } else if (e?.statusCode >= 400 && e?.statusCode < 500) {
                // Don't retry other request errors
                return new StatusError(500, "Error during login")
            } else {
                // We do retry all kinds of connection or server errors (500+)
                return undefined;
            }
        }
    }
);

export const refreshToken = withRetries('refreshToken', async (refreshToken: string, userIp: string) =>
    (await authClient.oauth.refreshTokenGrant({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
    }, {
        initOverrides: withUserIpHeader(userIp)
    })).data,
    {
        shouldThrow: (e) => {
            console.log(`Refresh token failed with status ${e.statusCode}: ${e.message}`);

            if (e?.statusCode === 403) {
                // Don't retry hard authentication failures - return them explicitly
                return new StatusError(403, "Token refresh failed")
            } else if (e?.statusCode >= 400 && e?.statusCode < 500) {
                // Don't retry other request errors
                return new StatusError(500, "Error during token refresh")
            } else {
                // We do retry all kinds of connection or server errors (500+)
                return undefined;
            }
        }
    }
);

export type User = auth0.GetUsers200ResponseOneOfInner & {
    app_metadata: AppMetadata
};

// The AppMetadata schema for the data we store in Auth0:
export type AppMetadata =
    | BaseMetadata
    | TrialUserMetadata
    | PayingUserMetadata
    | TeamOwnerMetadata
    | TeamMemberMetadata;

interface BaseMetadata {
    feature_flags?: string[];
    banned?: boolean;
}

export interface TrialUserMetadata extends BaseMetadata {
    subscription_status: SubscriptionStatus;
    subscription_plan_id: number; // Paddle-specific plan id
    subscription_sku: SKU; // Generic subscription type id
    subscription_expiry: number;
}

export interface PayingUserMetadata extends TrialUserMetadata {
    payment_provider?: 'paddle' | 'paypro' | 'manual'; // Not set for old subscriptions only

    // Only set for Paddle customers. Used for transaction lookup API requests.
    paddle_user_id?: number | string; // New ids should all be strings.

    // Set for Paddle & PayPro customers. Paddle uses only for older accounts
    // where paddle_user_id isn't set. PayPro uses for API requests.
    subscription_id: number | string; // New ids should all be strings.

    subscription_quantity: number,
    last_receipt_url?: string, // Set after first successful payment
    update_url: string,
    cancel_url: string
}

export interface TeamOwnerMetadata extends PayingUserMetadata {
    team_member_ids: string[];
    locked_licenses?: number[]; // Array of timestamps - the moment locked licenses were last assigned
    subscription_owner_id?: string; // Owners can be members of their own team
}

export interface TeamMemberMetadata extends BaseMetadata {
    subscription_owner_id: string;
    joined_team_at?: number; // Timestamp when the owner was set. Undefined for old/manual cases.
}

export const LICENSE_LOCK_DURATION_MS = 1000 * 60 * 60 * 24 * 2; // 48h limit on reassigning licenses