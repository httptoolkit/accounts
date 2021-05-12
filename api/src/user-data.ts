import * as _ from 'lodash';
import moment from 'moment';

import { reportError } from './errors';

import type { UserAppData, UserBillingData } from '../../module/src/types';

import {
    getPaddleUserIdFromSubscription,
    getPaddleUserTransactions,
    isTeamSubscription
} from './paddle';
import {
    authClient,
    mgmtClient,
    LICENSE_LOCK_DURATION_MS,
    AppMetadata,
    TeamOwnerMetadata
} from './auth0';

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

async function getRawUserData(userId: string): Promise<Partial<UserAppData>> {
    // getUser is full live data for the user (/users/{id} - 15 req/second)
    const userData = await mgmtClient.getUser({ id: userId });

    const metadata = userData.app_metadata as AppMetadata;

    return {
        email: userData.email!,
        ...metadata
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

async function buildUserAppData(userId: string, userMetadata: Partial<UserAppData>) {
    if (isTeamSubscription(userMetadata.subscription_plan_id)) {
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

    if (userMetadata.subscription_owner_id) {
        // If there's a subscription owner for this user (e.g. they're a member of a team)
        // read the basic subscription details from the real owner across to this user.
        const subOwnerData = await mgmtClient.getUser({
            id: userMetadata.subscription_owner_id
        }).catch((e) => {
            reportError(e);
            return { app_metadata: undefined };
        });

        const subOwnerMetadata = subOwnerData.app_metadata as TeamOwnerMetadata;

        if (subOwnerMetadata && isTeamSubscription(subOwnerMetadata.subscription_plan_id)) {
            const maxTeamSize = getMaxTeamSize(subOwnerMetadata);

            const subTeamMembers = (
                subOwnerMetadata.team_member_ids || []
            ).slice(0, maxTeamSize);

            if (subTeamMembers.includes(userId)) {
                DELEGATED_TEAM_SUBSCRIPTION_PROPERTIES.forEach((field) => {
                    userMetadata![field] = subOwnerMetadata[field] as any;
                });
            } else {
                reportError(`Inconsistent team membership for ${userId}`);
                delete userMetadata.subscription_owner_id;
            }
        }
    }

    return userMetadata;
}

function getMaxTeamSize(ownerMetadata: TeamOwnerMetadata) {
    return ownerMetadata.subscription_quantity - countLockedLicenses(ownerMetadata);
}

function countLockedLicenses(userMetadata: TeamOwnerMetadata) {
    // Count the number of locked licenses, where the expiry data is still in the future:
    return (userMetadata.locked_licenses ?? [])
        .filter((lockStartTime) =>
            moment(lockStartTime).add(LICENSE_LOCK_DURATION_MS, 'milliseconds').isAfter()
        )
        .length;
}

async function getBillingData(
    userId: string,
    userMetadata: Partial<UserAppData>
): Promise<UserBillingData> {
    // Load transactions, team members and team owner in parallel:
    const [transactions, teamMembers, owner] = await Promise.all([
        getTransactions(userMetadata),
        getTeamMembers(userId, userMetadata),
        getTeamOwner(userId, userMetadata)
    ]);

    return {
        ..._.omit(userMetadata, [
            // Filter to just billing related non-duplicated data
            'feature_flags',
            'subscription_owner_id',
            'team_member_ids'
        ]),
        email: userMetadata.email!,
        transactions,
        team_members: teamMembers,
        team_owner: owner
    };
}

async function getTransactions(userMetadata: Partial<UserAppData>) {
    const paddleUserId = userMetadata.paddle_user_id
    // Older user metadata doesn't include the user id:
    ?? await getPaddleUserIdFromSubscription(userMetadata.subscription_id);

    // If you have ever had a subscription, we want to include your invoices in this response:
    return paddleUserId
        ? getPaddleUserTransactions(paddleUserId)
        : [];
}

async function getTeamMembers(userId: string, userMetadata: Partial<UserAppData>) {
    if (!isTeamSubscription(userMetadata.subscription_plan_id)) {
        return undefined;
    }

    // Sort to match their configured id order (so that if the quantities change,
    // we can consistently see who is now past the end of the list).
    const usersOwnedByTeam = _.sortBy(await getTeamMemberData(userId), (member) => {
        const memberIndex = userMetadata.team_member_ids?.indexOf(member.user_id!);
        if (memberIndex === -1) return Infinity;
        else return memberIndex;
    });

    const maxTeamSize = getMaxTeamSize(userMetadata as TeamOwnerMetadata);

    // If you currently have a team subscription, we need the basic data about your team
    // members included here too, so can you see and manage them:
    const teamMembers = usersOwnedByTeam.map((member, i) => ({
        id: member.user_id!,
        name: member.email!,
        error: !userMetadata.team_member_ids?.includes(member.user_id!)
                ? 'inconsistent-member-data'
            : i >= maxTeamSize
                ? 'member-beyond-team-limit'
            : undefined
    }));

    // Report any team member data errors:
    teamMembers.filter(m => m.error).forEach(({ id, error }) =>
        reportError(
            `Billing data member issue for ${id} of team ${userId}: ${error}`
        )
    );

    return teamMembers;
}

async function getTeamMemberData(teamOwnerId: string) {
    return mgmtClient.getUsers({
        q: `app_metadata.subscription_owner_id:${teamOwnerId}`,
        // 100 is the max value. If we have a team of >100 users, we'll need some paging
        // on our end in the UI anyway, so this'll do for now.
        per_page: 100
    });
}

async function getTeamOwner(userId: string, userMetadata: Partial<UserAppData>) {
    if (!userMetadata.subscription_owner_id) return undefined;

    const ownerId = userMetadata.subscription_owner_id;

    // We're a member of somebody else's team: get the owner
    try {
        const ownerData = (userMetadata.subscription_owner_id === userId
            ? userMetadata // If we're in our own team, use that data directly:
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
            reportError(`Billing data owner issue for ${userId}: ${error}`);
        }

        return {
            id: ownerId,
            name: ownerData.email,
            error
        };
    } catch (e) {
        reportError(e);
        return {
            id: ownerId,
            error: 'owner-unavailable'
        };
    }
}