import _ from 'lodash';
import moment from 'moment';

import * as log from 'loglevel';

import {
    AppMetadata,
    LICENSE_LOCK_DURATION_MS,
    PayingUserMetadata,
    TeamOwnerMetadata,
    TeamMemberMetadata,
    User,
    getUsersByEmail,
    createUser,
    updateUserMetadata,
    getUserById
} from './auth0';
import { formatErrorMessage, reportError, StatusError } from './errors';
import { flushMetrics, trackEvent } from './metrics';

async function getOrCreateUserData(email: string): Promise<User> {
    const users = await getUsersByEmail(email);
    if (users.length > 1) {
        throw new Error(`More than one user found for ${email}`);
    } else if (users.length === 1) {
        return users[0];
    } else {
        // Create the user, if they don't already exist:
        return createUser({
            email,
            connection: 'email',
            email_verified: true, // This ensures users don't receive an email code or verification
            app_metadata: {}
        });
    }
}

function dropUndefinedValues(obj: { [key: string]: any }) {
    Object.keys(obj).forEach((key: any) => {
        if (obj[key] === undefined) delete obj[key];
    });
}

export async function banUser(email: string) {
    const user = await getOrCreateUserData(email);
    await updateUserMetadata(user.user_id!, { banned: true });
}

export async function updateProUserData(email: string, subscription: Partial<PayingUserMetadata>) {
    dropUndefinedValues(subscription);

    const user = await getOrCreateUserData(email);
    const appData = user.app_metadata as AppMetadata;

    // Is the user already a member of a team?
    if (appData && 'subscription_owner_id' in appData) {
        const owner = await getUserById(appData.subscription_owner_id!);
        const ownerData = owner.app_metadata as TeamOwnerMetadata;

        if (ownerData.subscription_expiry > Date.now() && ownerData.subscription_status === 'active') {
            reportError(`Rejected Pro signup for ${email} because they're an active Team member`);
            throw new StatusError(409, "Cannot create Pro account for a member of an active team");
        }

        // Otherwise, the owner's team subscription must have been cancelled now, so we just need to
        // update the membership state on both sides:
        const updatedTeamMembers = ownerData.team_member_ids.filter(id => id !== user.user_id);
        await updateUserMetadata(appData.subscription_owner_id!, { team_member_ids: updatedTeamMembers });
        (subscription as Partial<TeamMemberMetadata>).subscription_owner_id = null as any; // Setting to null deletes the property
    }

    // If the user has another subscription with time left on it, this is probably a mistake
    // (some users do accidentally complete the checkout twice) which needs manual intervention.
    if (
        // Existing subscription that hasn't expired yet (48+ hours left)
        appData &&
        'subscription_expiry' in appData &&
        moment(appData.subscription_expiry).subtract(48, 'hour').valueOf() > Date.now() &&
        // Not just another event for the same sub (payment vs creation etc)
        (appData as PayingUserMetadata).subscription_id !== subscription.subscription_id

    ) {
        reportError(`Signup for existing Pro user ${email} with active subscription`);
    }

    if (!_.isEmpty(subscription)) {
        await updateUserMetadata(user.user_id!, subscription);
    }
}


export async function updateTeamData(email: string, subscription: Partial<PayingUserMetadata>) {
    const currentUserData = await getOrCreateUserData(email);
    const currentMetadata = (currentUserData.app_metadata ?? {}) as AppMetadata;
    const newMetadata: Partial<TeamOwnerMetadata> = subscription;

    if (!('team_member_ids' in currentMetadata)) {
        // If the user is not currently a team owner: give them an empty team
        newMetadata.team_member_ids = [];
    }

    // Cleanup locked licenses: drop all locks that expired in the past
    newMetadata.locked_licenses = ((currentMetadata as TeamOwnerMetadata).locked_licenses ?? [])
        .filter((lockStartTime) =>
            lockStartTime + LICENSE_LOCK_DURATION_MS > Date.now()
        )

    dropUndefinedValues(newMetadata);

    if (!_.isEmpty(newMetadata)) {
        await updateUserMetadata(currentUserData.user_id!, newMetadata);
    }
}

export function parseCheckoutPassthrough(passthroughData: string | undefined) {
    try {
        if (!passthroughData) {
            throw new Error('Passthrough was empty');
        }

        const parsedPassthrough = JSON.parse(passthroughData) ?? {};

        if (!Object.keys(parsedPassthrough!).length) {
            throw new Error('Parsed passthrough data has no content');
        }

        return parsedPassthrough as Record<string, string | undefined>;
    } catch (e) {
        log.error(e);
        reportError(`Failed to parse passthrough data: ${formatErrorMessage(e)}`);
        // We report errors here, but continue - we'll just skip metrics in this case
    }
}

// Independently of overall stats, we also log checkout events so we can measure failures:
export async function reportSuccessfulCheckout(checkoutId: string | undefined) {
    if (!checkoutId) return; // Set in redirect-to-checkout, so may not exist for manual checkouts

    // Track successes, so we can calculate checkout conversion rates:
    trackEvent(checkoutId, 'Checkout', 'Success');
    await flushMetrics();
}