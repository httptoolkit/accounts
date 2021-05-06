import { reportError } from './errors';

import type { UserData } from '../../module/src/types';

import { TEAM_SUBSCRIPTION_IDS } from './paddle';
import { authClient, mgmtClient } from './auth0';

export async function getUserAppData(accessToken: string) {
    const userId = await getUserId(accessToken);
    const rawUserData = await getRawUserData(userId);
    return getUserSubscriptionData(userId, rawUserData);
}

// A cache to avoid hitting userinfo unnecessarily.
const tokenIdCache: { [accessToken: string]: string } = {};

async function getUserId(accessToken: string): Promise<string> {
    let userId = tokenIdCache[accessToken];

    if (userId) {
        console.log(`Matched token to user id ${userId} from cache`);
        return userId;
    } else {
        // getProfile is only minimal data, updated at last login (/userinfo - 5 req/minute/user)
        const user: { sub: string } | undefined = await authClient.getProfile(accessToken);

        if (!user) {
            throw new Error("User could not be found in getUserId");
        } else if (typeof user.sub !== 'string') {
            console.log(JSON.stringify(user));
            throw new Error(`Unexpected getProfile result: ${user}`);
        }

        userId = tokenIdCache[accessToken] = user.sub;
        console.log(`Looked up user id ${userId} from token`);
        return userId;
    }
}

async function getRawUserData(userId: string): Promise<Partial<UserData>> {
    // getUser is full live data for the user (/users/{id} - 15 req/second)
    const userData = await mgmtClient.getUser({ id: userId });

    return {
        email: userData.email!,
        ...userData.app_metadata
    };
}

const EXTRACTED_TEAM_SUBSCRIPTION_PROPERTIES = [
    'subscription_status',
    'subscription_id',
    'subscription_plan_id',
    'subscription_expiry',
    'subscription_quantity',
    'last_receipt_url',
    'update_url',
    'cancel_url',
    'team_member_ids'
] as const;

const DELEGATED_TEAM_SUBSCRIPTION_PROPERTIES = [
    'subscription_id',
    'subscription_status',
    'subscription_expiry',
    'subscription_plan_id'
] as const;

async function getUserSubscriptionData(userId: string, userMetadata: Partial<UserData>) {
    if (userMetadata && TEAM_SUBSCRIPTION_IDS.includes(userMetadata.subscription_plan_id!)) {
        // If you have a team subscription, you're the *owner* of a team, not a member.
        // That means your subscription data isn't actually for *you*, it's for
        // the actual team members. Move it into a separate team_subscription to make that clear.
        userMetadata.team_subscription = {};
        EXTRACTED_TEAM_SUBSCRIPTION_PROPERTIES.forEach((key) => {
            const teamSub = userMetadata!.team_subscription! as any;
            teamSub[key] = userMetadata![key];
            delete userMetadata![key];
        }, {});
    }

    if (userMetadata?.subscription_owner_id) {
        // If there's a subscription owner for this user (e.g. they're a member of a team)
        // read the basic subscription details from the real owner across to this user.
        const subOwnerData = await mgmtClient.getUser({
            id: userMetadata.subscription_owner_id
        }).catch((e) => {
            reportError(e);
            return { app_metadata: undefined };
        });

        const subOwnerMetadata = subOwnerData.app_metadata;

        if (subOwnerMetadata && TEAM_SUBSCRIPTION_IDS.includes(subOwnerMetadata.subscription_plan_id)) {
            const subTeamMembers = (
                subOwnerMetadata.team_member_ids || []
            ).slice(0, subOwnerMetadata.subscription_quantity || 0);

            if (subTeamMembers.includes(userId)) {
                DELEGATED_TEAM_SUBSCRIPTION_PROPERTIES.forEach((field) => {
                    userMetadata![field] = subOwnerMetadata[field];
                });
            } else {
                reportError(`Inconsistent team membership for ${userId}`);
                delete userMetadata.subscription_owner_id;
            }
        }
    }

    return userMetadata;
}