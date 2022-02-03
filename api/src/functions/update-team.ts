import * as _ from 'lodash';
import { initSentry, catchErrors, reportError, StatusError } from '../errors';
initSentry();

import {
    mgmtClient,
    AppMetadata,
    TeamMemberMetadata,
    TeamOwnerMetadata,
    User,
    LICENSE_LOCK_DURATION_MS
} from '../auth0';
import { getCorsResponseHeaders } from '../cors';
import { getMaxTeamSize, getTeamMemberData, getUserId } from '../user-data';
import { isTeamSubscription } from '../paddle';

const BearerRegex = /^Bearer (\S+)$/;

/*
This endpoint expects requests to be sent with a Bearer authorization,
containing a valid access token for the Auth0 app.

Assuming the token is valid, this function updates the team owned by
the token's user to the given input, if possible. If not, it returns
an error.
*/
export const handler = catchErrors(async (event) => {
    let headers = getCorsResponseHeaders(event);

    if (event.httpMethod !== 'OPTIONS') {
        // Very briefly cache results, to avoid completely unnecessary calls
        headers['Cache-Control'] = 'private, max-age=10';
    }

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    } else if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: '' };
    }

    const { authorization } = event.headers;

    const tokenMatch = BearerRegex.exec(authorization);
    if (!tokenMatch) return { statusCode: 401, headers, body: '' };
    const accessToken = tokenMatch[1];

    try {
        const ownerId = await getUserId(accessToken);

        const [userData, memberData] = await Promise.all([
            mgmtClient.getUser({ id: ownerId }),
            getTeamMemberData(ownerId)
        ]);

        const ownerData = userData.app_metadata as TeamOwnerMetadata;
        if (!isTeamSubscription(ownerData?.subscription_plan_id)) {
            throw new StatusError(403, "Your account does not have a Team subscription");
        }

        const input: {
            idsToRemove?: string[],
            emailsToAdd?: string[]
        } = JSON.parse(event.body!);

        const idsToRemove = input.idsToRemove ?? [];
        const emailsToAdd = input.emailsToAdd ?? [];

        console.log(`For team ${ownerId}: add ${
            emailsToAdd.join(', ') || 'nobody'
        } and remove ${
            idsToRemove.join(', ') || 'nobody'
        }`);

        // Licenses are locked if they are added and removed within 48 hours. If that happens they
        // can't be reassigned again until the 48 hours expires. This ensures team licenses cover
        // all the users who frequently use the app (i.e. you shouldn't be able to swap 1 license
        // around 100 people whenever somebody needs it for a minute).
        const licensesToLock = memberData
            .filter((member) => idsToRemove.includes(member.user_id!))
            .map((member) => (member.app_metadata as TeamMemberMetadata)?.joined_team_at)
            .filter((memberJoinDate) => !!memberJoinDate &&
                Date.now() - memberJoinDate <= LICENSE_LOCK_DURATION_MS
            ) as number[];

        const maxTeamSize = getMaxTeamSize(ownerData) - licensesToLock.length;

        const newTeamSize = ownerData.team_member_ids.length +
            emailsToAdd.length -
            idsToRemove.length;

        if (newTeamSize > maxTeamSize) {
            throw new StatusError(403,
                "The proposed team would use more licenses than you have available"
            );
        }

        validateTeamMembersBeforeRemove(ownerData, memberData, idsToRemove);
        validateNewMemberEmails(memberData, emailsToAdd);

        // For each new member, get either their current data, or just keep their email
        // (we'll create new accounts for those in a minute)
        const newMemberAccounts = await Promise.all(emailsToAdd.map(async (email) => {
            const matchingUsers = (await mgmtClient.getUsersByEmail(email));
            if (matchingUsers.length === 1) {
                return matchingUsers[0];
            } else if (matchingUsers.length > 1) {
                // Should never happen, since we use email itself as our user id, but
                // it's worth handling explicitly anyway:
                throw new Error(`More than one user found for email ${email}`);
            } else {
                return email;
            }
        }));
        validateNewMemberAccounts(ownerId, newMemberAccounts);

        // All validated (so this should work!) - now actually update the users:
        await unlinkTeamMembers(idsToRemove);
        const newMemberIds = await linkNewTeamMembers(ownerId, newMemberAccounts);

        // Update the owner:
        const updatedTeamIds = ownerData.team_member_ids
            .filter(id => !idsToRemove.includes(id))
            .concat(newMemberIds);

        const updatedLicenseLocks = (ownerData.locked_licenses ?? [])
            .concat(licensesToLock)
            .filter((lock) =>
                // Keep only the locks that haven't expired:
                lock + LICENSE_LOCK_DURATION_MS >= Date.now()
            );

        await mgmtClient.updateAppMetadata({ id: ownerId }, {
            team_member_ids: updatedTeamIds,
            locked_licenses: updatedLicenseLocks
        } as TeamOwnerMetadata);

        return { statusCode: 200, headers, body: 'success' };
    } catch (e) {
        await reportError(e);

        return {
            statusCode: e.statusCode ?? 500,
            headers: { ...headers, 'Cache-Control': 'no-store' },
            body: e.message
        }
    }
});

function validateTeamMembersBeforeRemove(
    ownerData: TeamOwnerMetadata,
    memberData: User[],
    idsToRemove: string[]
) {
    if (_.uniq(idsToRemove).length !== idsToRemove.length) {
        throw new StatusError(400, "Cannot remove a team member more than once");
    }

    // This effectively checks membership via subscription_owner_id (used to populate memberData)
    const membersToRemove = memberData.filter((member) => idsToRemove.includes(member.user_id!));
    if (membersToRemove.length !== idsToRemove.length) {
        throw new StatusError(409,
            "Cannot remove a team member who is not registered as a member of the team"
        );
    }

    // This checks membership via team_member_ids, just in case data is inconsistent somehow:
    if (idsToRemove.some(id => !ownerData.team_member_ids.includes(id))) {
        throw new StatusError(409,
            "Cannot remove a team member who is not listed as a member of the team"
        );
    }

}

async function unlinkTeamMembers(idsToRemove: string[]) {
    const removalResult = await Promise.all<boolean | Error>(
        idsToRemove.map(async (idToRemove) =>
            mgmtClient.updateAppMetadata({ id: idToRemove }, {
                subscription_owner_id: null,
                joined_team_at: null
            })
            .then(() => true)
            .catch((e) => {
                console.log(`Failed to remove team member ${idToRemove}`, e);
                return e; // Return error but successfully
            })
        )
    );

    const removalErrors = removalResult.filter(r => _.isError(r));
    if (removalErrors.length > 0) {
        console.log(`${
            removalErrors.length
        } errors removing ${
            idsToRemove.length
        } team members`);
        await Promise.all(removalErrors.map(e => reportError(e as Error)));

        throw removalErrors[0];
    }
}

function validateNewMemberEmails(existingMemberData: User[], emailsToAdd: string[]) {
    if (_.uniq(emailsToAdd).length !== emailsToAdd.length) {
        throw new StatusError(400, "Cannot add a team member more than once");
    }

    if (emailsToAdd.some((email) => existingMemberData.some(m => m.email === email))) {
        throw new StatusError(409, "Cannot add team member who is already present");
    }
}

function validateNewMemberAccounts(ownerId: string, newMembers: Array<User | string>) {
    newMembers.forEach((member) => {
        if (_.isObject(member)) checkUserCanJoinTeams(ownerId, member);
    });
}

async function linkNewTeamMembers(ownerId: string, membersToAdd: Array<User | string>) {
    const linkUserResults = await Promise.all<string | Error>(
        membersToAdd.map(async (user) => {
            const appMetadata = {
                subscription_owner_id: ownerId,
                joined_team_at: Date.now()
            } as TeamMemberMetadata;

            const updatePromise = _.isObject(user)
                ? mgmtClient.updateAppMetadata({ id: user.user_id! }, appMetadata)
                : mgmtClient.createUser({
                    email: user,
                    email_verified: true,
                    connection: 'email',
                    app_metadata: appMetadata
                });

            return updatePromise
                .then(({ user_id }) => user_id!)
                .catch((e) => {
                    console.log(`Failed to add team member ${
                        _.isObject(user) ? user.user_id : user
                    }`, e);
                    return e; // Return error but successfully
                });
        })
    );

    const linkUserErrors = linkUserResults.filter(r => _.isError(r));
    if (linkUserErrors.length > 0) {
        console.log(`${
            linkUserErrors.length
        } errors adding ${
            membersToAdd.length
        } team members`);
        await Promise.all(linkUserErrors.map(e => reportError(e as Error)));

        throw linkUserErrors[0];
    }

    return linkUserResults as string[];
}

function checkUserCanJoinTeams(ownerId: string, user: User): true {
    const metadata = (user.app_metadata ?? {}) as AppMetadata;

    if ('subscription_owner_id' in metadata) {
        // If you're already in a team, you can't join a new team until you leave
        throw new StatusError(409,
            "Cannot add a user to a team if they already have a team"
        );
    } else if ('subscription_status' in metadata) {
        // Users who recently cancelled don't count as actively subscribed users for
        // our purposes, so that you can cancel a private sub to immediately become
        // addable to your new company subscription.
        if (metadata.subscription_status === 'deleted') return true;

        // The owner is also allowed to join the team: although they have a subscription,
        // unless they're a member they can't use it. Other team owners still can't join.
        if (user.user_id === ownerId) return true;

        // Otherwise, unless your data has expired, you have some kind of active
        // subscription (and so you can't be added to a team).
        if (metadata.subscription_expiry! + SUB_EXPIRY_MARGIN_MS > Date.now()) {
            throw new StatusError(409,
                "Cannot add a user to a team if they have an active subscription"
            );
        }
    }

    return true; // No team, no active subscription => you can be added
}

// We leave a little margin on expiry checks, so that tiny delays in webhook
// delivery don't leave users in weird limbo.
const SUB_EXPIRY_MARGIN_MS = 1000 * 60;