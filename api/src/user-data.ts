import * as _ from 'lodash';
import NodeCache from 'node-cache';

import { reportError } from './errors';

import type {
    TransactionData,
    UserAppData,
    UserBillingData
} from '../../module/src/types';

import {
    getPaddleIdForSku,
    getPaddleUserIdFromSubscription,
    lookupPaddleUserTransactions,
    getSkuForPaddleId
} from './paddle';
import {
    authClient,
    mgmtClient,
    LICENSE_LOCK_DURATION_MS,
    AppMetadata,
    TeamOwnerMetadata,
    TeamMemberMetadata,
    PayingUserMetadata
} from './auth0';
import {
    getSku,
    isTeamSubscription
} from './products';

type RawMetadata = Partial<AppMetadata> & {
    email: string;
};

// User app data is the effective subscription of the user. For Pro that's easy,
// for teams: team members have the subscription of the team owner. Team owners
// have no effective subscription (unless they are owner + member).
export async function getUserAppData(accessToken: string): Promise<UserAppData> {
    const userId = await getUserId(accessToken);
    const rawUserData = await getRawUserData(userId);
    return await buildUserAppData(userId, rawUserData) as UserAppData;
}

// User billing data is the actual subscription of the user. For Pro that's
// easy, for teams: team members have no subscription, just a membership,
// while owners have all their normal subscription state + a list of members.
export async function getUserBillingData(accessToken: string) {
    const userId = await getUserId(accessToken);
    const rawUserData = await getRawUserData(userId);
    return getBillingData(userId, rawUserData);
}

// A cache to avoid hitting userinfo unnecessarily.
const tokenIdCache: { [accessToken: string]: string } = {};

export async function getUserId(accessToken: string): Promise<string> {
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

async function getRawUserData(userId: string): Promise<RawMetadata> {
    // getUser is full live data for the user (/users/{id} - 15 req/second)
    const userData = await mgmtClient.getUser({ id: userId });

    const metadata = userData.app_metadata;

    return migrateOldUserData({
        email: userData.email!,
        ...metadata
    });
}

function migrateOldUserData(data: RawMetadata): RawMetadata {
    if ('subscription_plan_id' in data && !data.subscription_sku) {
        data.subscription_sku = getSkuForPaddleId(data.subscription_plan_id);
    }

    // Just temporarily (remove after May 2023) we return a synthetic subscription_plan_id
    // even if not present, as a quick hack to avoid breaking old UI implementations:
    if ('subscription_sku' in data && !data.subscription_plan_id) {
        data.subscription_plan_id = getPaddleIdForSku(data.subscription_sku ?? 'pro-monthly');
    }

    // All subscription & paddle ids should be strings now
    if ('subscription_id' in data && _.isNumber(data.subscription_id)) {
        data.subscription_id = data.subscription_id.toString();
    }
    if ('paddle_user_id' in data && _.isNumber(data.paddle_user_id)) {
        data.paddle_user_id = data.paddle_user_id.toString();
    }

    return data;
}

// We use these internally for some processing, but they're not useful
// externally so we should avoid returning them from the API:
const INTERNAL_FIELDS =[
    'subscription_id',
    'paddle_user_id'
] as const;

// All subscription-related properties, which are hidden if the user's
// subscription data has expired:
const SUBSCRIPTION_PROPERTIES = [
    'subscription_status',
    'subscription_id',
    'subscription_sku',
    'subscription_plan_id',
    'subscription_expiry',
    'subscription_quantity',
    'last_receipt_url',
    'paddle_user_id',
    'update_url',
    'cancel_url',
    'team_member_ids',
    'locked_licenses',
    'subscription_owner_id',
    'joined_team_at'
] as const;

// The subscription properties extracted from team owners and delegated to members:
const EXTRACTED_TEAM_SUBSCRIPTION_PROPERTIES = [
    'subscription_status',
    'subscription_sku',
    'subscription_plan_id',
    'subscription_expiry',
    'subscription_quantity',
    'last_receipt_url',
    'update_url',
    'cancel_url',
    'team_member_ids'
] as const;

const DELEGATED_TEAM_SUBSCRIPTION_PROPERTIES = [
    'subscription_status',
    'subscription_expiry',
    'subscription_sku',
    'subscription_plan_id'
] as const;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function buildUserAppData(userId: string, rawMetadata: RawMetadata) {
    const userMetadata: Partial<UserAppData> =_.cloneDeep(_.omit(rawMetadata, INTERNAL_FIELDS));

    const sku = getSku(rawMetadata);
    if (isTeamSubscription(sku)) {
        // If you have a team subscription, you're the *owner* of a team, not a member.
        // That means your subscription data isn't actually for *you*, it's for
        // the actual team members. Move it into a separate team_subscription to make that clear.
        userMetadata.team_subscription = {};
        delete (userMetadata as TeamOwnerMetadata)['locked_licenses'];
        EXTRACTED_TEAM_SUBSCRIPTION_PROPERTIES.forEach((key) => {
            const teamSub = userMetadata.team_subscription as any;
            teamSub[key] = userMetadata[key];
            delete userMetadata![key];
        });
    }

    if (userMetadata.subscription_owner_id) {
        // If there's a subscription owner for this user (e.g. they're a member of a team)
        // read the basic subscription details from the real owner across to this user.
        const subOwnerData = await mgmtClient.getUser({
            id: userMetadata.subscription_owner_id
        }).catch(async (e) => {
            await reportError(e);
            return { app_metadata: undefined };
        });

        const subOwnerMetadata = subOwnerData.app_metadata as TeamOwnerMetadata;
        const teamSku = getSku(subOwnerMetadata);

        if (subOwnerMetadata && isTeamSubscription(teamSku)) {
            const maxTeamSize = getMaxTeamSize(subOwnerMetadata);

            const subTeamMembers = (
                subOwnerMetadata.team_member_ids || []
            ).slice(0, maxTeamSize);

            if (subTeamMembers.includes(userId)) {
                DELEGATED_TEAM_SUBSCRIPTION_PROPERTIES.forEach((field) => {
                    userMetadata![field] = subOwnerMetadata[field] as any;
                });
            } else {
                await reportError(`Inconsistent team membership for ${userId}`);
                delete userMetadata.subscription_owner_id;
            }
        }
    }

    // Annoyingly due to an old implementation issue in the UI
    // (https://github.com/httptoolkit/httptoolkit-ui/commit/acb42aa9e4c05659beae2039854598c982083ffe)
    // we need to return some subscription_id in all paid cases, even though it's never used.
    // We can remove this later (e.g. May 2023) - it will effectively make subscribed users
    // appear unsubscribed until their UI updates. Most UIs update fairly quickly though.
    if ('subscription_id' in rawMetadata) { // For paid users only (raw data because this is stripped)
        (userMetadata as any).subscription_id = -1;
    }

    const metadataExpiry = userMetadata.subscription_expiry
        // No expiry = never expire (shouldn't happen, but just in case):
        ?? Number.POSITIVE_INFINITY;
    if (metadataExpiry < (Date.now() - ONE_DAY_MS)) {
        SUBSCRIPTION_PROPERTIES.forEach((key) => {
            delete userMetadata[key as keyof typeof userMetadata];
        });
    }

    return userMetadata;
}

export function getMaxTeamSize(ownerMetadata: TeamOwnerMetadata) {
    return ownerMetadata.subscription_quantity - countLockedLicenses(ownerMetadata);
}

function countLockedLicenses(userMetadata: TeamOwnerMetadata) {
    // Count the number of locked licenses, where the expiry data is still in the future:
    return (userMetadata.locked_licenses ?? [])
        .filter((lockStartTime) =>
            lockStartTime + LICENSE_LOCK_DURATION_MS >= Date.now()
        )
        .length;
}

async function getBillingData(
    userId: string,
    rawMetadata: RawMetadata
): Promise<UserBillingData> {
    // Load transactions, team members and team owner in parallel:
    const [transactions, teamMembers, owner, lockedLicenseExpiries] = await Promise.all([
        getTransactions(rawMetadata),
        getTeamMembers(userId, rawMetadata),
        getTeamOwner(userId, rawMetadata),
        getLockedLicenseExpiries(rawMetadata)
    ]);

    return {
        ..._.cloneDeep(_.omit(rawMetadata, [
            // Filter to just billing related non-duplicated data
            'feature_flags',
            'subscription_owner_id',
            'team_member_ids',
            'locked_licenses',
            ...INTERNAL_FIELDS
        ])),
        email: rawMetadata.email!,
        transactions,
        team_members: teamMembers,
        team_owner: owner,
        locked_license_expiries: lockedLicenseExpiries
    };
}

// We temporarily cache per-user transactions for performance (Paddle can be *very* slow)
const transactionsCache = new NodeCache({
    stdTTL: 60 * 60 // Cached for 1h
});

async function getTransactions(rawMetadata: RawMetadata) {
    const billingMetadata = rawMetadata as PayingUserMetadata;

    let transactionsRequest: Promise<TransactionData[]>;
    let transactionsCacheKey: string;

    if (
        billingMetadata.payment_provider === 'paddle' ||
        !billingMetadata.payment_provider // Subscriptions that predate multiple providers
    ) {
        const paddleUserId = await getPaddleUserId(billingMetadata);
        if (!paddleUserId) return [];

        transactionsCacheKey = `paddle-${paddleUserId}`

        // We always query for fresh transaction data (even if we might return cached data
        // below in the meantime)
        transactionsRequest = lookupPaddleUserTransactions(paddleUserId);
    } else {
        throw new Error(`Could not get transactions for unknown payment provider: ${
            billingMetadata.payment_provider
        }`);
    }

    // When the lookup completes, cache the result:
    transactionsRequest.then((transactions) => {
        transactionsCache.set(transactionsCacheKey, transactions);
    });

    if (transactionsCache.has(transactionsCacheKey)) {
        // If we already have a cache result, we return that for now (transactions will
        // still update the cache in the background though).
        return transactionsCache.get<TransactionData[]>(transactionsCacheKey)!;
    } else {
        // If there's no cached data, we just wait until the full request is done, like normal:
        return transactionsRequest;
    }}

// We cache paddle subscription to user id map, which never changes
const paddleUserIdCache: { [subscriptionId: string | number]: string | number } = {};

async function getPaddleUserId(billingMetadata: PayingUserMetadata) {
    const paddleUserId = billingMetadata.paddle_user_id
        // If not set, read from the cache, from previous user id lookups:
        ?? paddleUserIdCache[billingMetadata.subscription_id!]
        // Otherwise, for older user metadata that doesn't include the user id, we look it up:
        ?? await getPaddleUserIdFromSubscription(billingMetadata.subscription_id);

    // Cache this id for faster lookup next time:
    if (!billingMetadata.paddle_user_id) {
        paddleUserIdCache[billingMetadata.subscription_id!] = paddleUserId;
    }

    return paddleUserId;
}

async function getTeamMembers(userId: string, rawMetadata: RawMetadata) {
    const teamOwnerMetadata = rawMetadata as TeamOwnerMetadata;

    const sku = getSku(teamOwnerMetadata);
    if (!isTeamSubscription(sku)) return undefined;

    // Sort to match their configured id order (so that if the quantities change,
    // we can consistently see who is now past the end of the list).
    const usersOwnedByTeam = _.sortBy(await getTeamMemberData(userId), (member) => {
        const memberIndex = teamOwnerMetadata.team_member_ids?.indexOf(member.user_id!);
        if (memberIndex === -1) return Infinity;
        else return memberIndex;
    });

    const maxTeamSize = getMaxTeamSize(teamOwnerMetadata);

    // If you currently have a team subscription, we need the basic data about your team
    // members included here too, so can you see and manage them:
    const teamMembers = usersOwnedByTeam.map((member, i) => ({
        id: member.user_id!,
        name: member.email!,
        locked: ( // Was the user added super recently, so removing them will lock the license?
            (member.app_metadata as TeamMemberMetadata)?.joined_team_at || 0
        ) + LICENSE_LOCK_DURATION_MS > Date.now(),
        error: !teamOwnerMetadata.team_member_ids?.includes(member.user_id!)
                ? 'inconsistent-member-data'
            : i >= maxTeamSize
                ? 'member-beyond-team-limit'
            : undefined
    }));

    // Report any team member data errors:
    await Promise.all(
        teamMembers.filter(m => m.error).map(({ id, error }) =>
            reportError(
                `Billing data member issue for ${id} of team ${userId}: ${error}`
            )
        )
    );

    if (teamMembers.length !== teamOwnerMetadata.team_member_ids?.length) {
        await reportError(`Missing team members for team ${userId}`);
    }

    return teamMembers;
}

export async function getTeamMemberData(teamOwnerId: string) {
    return mgmtClient.getUsers({
        q: `app_metadata.subscription_owner_id:${teamOwnerId}`,
        // 100 is the max value. If we have a team of >100 users, we'll need some paging
        // on our end in the UI anyway, so this'll do for now.
        per_page: 100
    });
}

async function getTeamOwner(userId: string, rawMetadata: RawMetadata) {
    const teamMemberData = rawMetadata as TeamMemberMetadata;
    if (!teamMemberData.subscription_owner_id) return undefined;

    const ownerId = teamMemberData.subscription_owner_id;

    // We're a member of somebody else's team: get the owner
    try {
        const ownerData = (teamMemberData.subscription_owner_id === userId
            ? teamMemberData // If we're in our own team, use that data directly:
            : await getRawUserData(ownerId)
        ) as TeamOwnerMetadata & { email: string };

        const teamMemberIds = ownerData.team_member_ids ?? [];
        const maxTeamSize = getMaxTeamSize(ownerData);
        const teamMemberIndex = teamMemberIds.indexOf(userId)

        const isInTeam = teamMemberIndex !== -1;
        const isWithinQuantity = isInTeam && teamMemberIndex < maxTeamSize;

        const error = !isInTeam
                ? 'inconsistent-owner-data'
            : !isWithinQuantity
                ? 'member-beyond-owner-limit'
            : undefined;

        if (error) {
            await reportError(`Billing data owner issue for ${userId}: ${error}`);
        }

        return {
            id: ownerId,
            name: ownerData.email,
            error
        };
    } catch (e: any) {
        await reportError(e);
        return {
            id: ownerId,
            error: 'owner-unavailable'
        };
    }
}

function getLockedLicenseExpiries(rawMetadata: RawMetadata) {
    const teamOwnerMetadata = rawMetadata as TeamOwnerMetadata;
    if (!teamOwnerMetadata.locked_licenses) return;

    return teamOwnerMetadata
        .locked_licenses
        ?.map((lockStartTime) =>
            lockStartTime + LICENSE_LOCK_DURATION_MS
        ).filter((lockExpiryTime) =>
            lockExpiryTime > Date.now()
        );
}