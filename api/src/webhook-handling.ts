import _ from 'lodash';
import moment from 'moment';

import log from 'loglevel';

import {
    AppMetadata,
    LICENSE_LOCK_DURATION_MS,
    PayingUserMetadata,
    TeamOwnerMetadata,
    TeamMemberMetadata,
    getOrCreateUser,
    updateUserMetadata,
    getUserById
} from './user-data-facade.ts';
import { formatErrorMessage, reportError, StatusError } from './errors.ts';
import { flushMetrics, trackEvent } from './metrics.ts';

function dropUndefinedValues(obj: { [key: string]: any }) {
    Object.keys(obj).forEach((key: any) => {
        if (obj[key] === undefined) delete obj[key];
    });
}

export async function banUser(email: string) {
    const user = await getOrCreateUser(email);
    await updateUserMetadata(user.user_id!, { banned: true });
}

export async function updateProUserData(email: string, subscriptionUpdate: Partial<PayingUserMetadata>) {
    dropUndefinedValues(subscriptionUpdate);

    const user = await getOrCreateUser(email);
    const appData = user.app_metadata;

    // Does the user already have unrelated subscription data?
    if (
        appData &&
        'subscription_id' in appData &&
        subscriptionUpdate.subscription_id &&
        appData.subscription_id !== subscriptionUpdate.subscription_id
    ) {
        // If the user has an existing subscription and we get an event for a new one, there's a few
        // possibilities. One (especially with PayPro) is that they're manually renewing an expiring
        // one, or they have briefly overlapping subscriptions and the old one has now lapsed.

        // The possibilities here are quite complicated (e.g. new subs can start as 'cancelled' due to
        // manual renewal configuration in PayPro) but "latest expiry" tends to be the right answer.

        if (
            !subscriptionUpdate.subscription_expiry || // Cancel event (applied to wrong sub)
            subscriptionUpdate.subscription_expiry! < appData.subscription_expiry
        ) {
            log.warn(`User ${email} received a outdated subscription event for an inactive subscription - ignoring`);
            return; // Ignore the update entirely in this case
        }

        // If there's an update for a different sub, and the user's existing subscription is active and has
        // plenty of time left on it, this is probably a mistake (some users do accidentally complete the
        // checkout twice) which needs manual intervention.
        if (
            appData.subscription_status !== 'past_due' &&
            moment(appData.subscription_expiry).subtract(5, 'days').valueOf() > Date.now()
        ) {
            reportError(`Mismatched subscription event for Pro user ${email} with existing subscription`, {
                extraMetadata: {
                    existing: appData,
                    updated: subscriptionUpdate
                }
            });
        }
    }

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
        (subscriptionUpdate as Partial<TeamMemberMetadata>).subscription_owner_id = null as any; // Setting to null deletes the property
    }

    if (!_.isEmpty(subscriptionUpdate)) {
        await updateUserMetadata(user.user_id!, subscriptionUpdate);
    }
}


export async function updateTeamData(email: string, subscription: Partial<PayingUserMetadata>) {
    const currentUserData = await getOrCreateUser(email);
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