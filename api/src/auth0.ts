import * as auth0 from 'auth0';
import { SubscriptionStatus } from '../../module/src/types';

const {
    AUTH0_DOMAIN,
    AUTH0_APP_CLIENT_ID,
    AUTH0_MGMT_CLIENT_ID,
    AUTH0_MGMT_CLIENT_SECRET
} = process.env;

export const AUTH0_DATA_SIGNING_PRIVATE_KEY = `
-----BEGIN RSA PRIVATE KEY-----
${process.env.SIGNING_PRIVATE_KEY}
-----END RSA PRIVATE KEY-----
`;

export const authClient = new auth0.AuthenticationClient({
    domain: AUTH0_DOMAIN!,
    clientId: AUTH0_APP_CLIENT_ID
});

export const mgmtClient = new auth0.ManagementClient({
    domain: AUTH0_DOMAIN!,
    clientId: AUTH0_MGMT_CLIENT_ID,
    clientSecret: AUTH0_MGMT_CLIENT_SECRET
});

export type User = auth0.User;

// The AppMetadata schema for the data we store in Auth0:
export type AppMetadata =
    | BaseMetadata
    | TrialUserMetadata
    | PayingUserMetadata
    | TeamOwnerMetadata
    | TeamMemberMetadata;

interface BaseMetadata {
    feature_flags: string[];
}

export interface TrialUserMetadata extends BaseMetadata {
    subscription_status: SubscriptionStatus;
    subscription_plan_id: number;
    subscription_expiry: number;
}

export interface PayingUserMetadata extends TrialUserMetadata {
    paddle_user_id?: number, // Optional just because it's new
    subscription_id: number;
    subscription_quantity: number,
    last_receipt_url?: string, // Set after first successful payment
    update_url: string,
    cancel_url: string
}

export interface TeamOwnerMetadata extends PayingUserMetadata {
    team_member_ids: string[];
    locked_licenses?: string[]; // Array of time strings - the moment locked licenses were last assigned
    subscription_owner_id?: string; // Owners can be members of their own team
}

export interface TeamMemberMetadata extends BaseMetadata {
    subscription_owner_id: string;
    joined_team_at?: string; // UTC time string when the owner was set. Undefined for old/manual cases.
}

export const LICENSE_LOCK_DURATION_MS = 1000 * 60 * 24 * 2; // 48h limit on reassigning licenses