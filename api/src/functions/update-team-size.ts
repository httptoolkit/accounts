import log from 'loglevel';

import { delay } from '@httptoolkit/util';
import { initSentry, catchErrors, reportError, StatusError } from '../errors.ts';
initSentry();

import {
    TeamOwnerMetadata,
    getUserById
} from '../user-data-facade.ts';
import { getCorsResponseHeaders } from '../cors.ts';
import { getUserId } from '../user-data.ts';
import { getSku, isTeamSubscription } from '../products.ts';
import { updateSubscriptionQuantity } from '../paddle.ts';

const BearerRegex = /^Bearer (\S+)$/;

/**
This endpoint expects requests to be sent with a Bearer authorization,
containing a valid access token for the Auth0 app.

Assuming the token is valid, this function updates the subscription for
the account team to the given quantity. For upgrades, this results in a
pro-rated bill against the customer's existing payment method. For
downgrades, this does nothing, but lowers the cost of the customer's
next bill. This endpoint does *not* actually apply the upgrade - it just
sends the request to the payment provider.

Downgrades are not allowed below the number of currently assigned licenses.
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
        const userData = await getUserById(ownerId);
        const ownerData = userData.app_metadata as TeamOwnerMetadata;

        const sku = getSku(ownerData);
        if (!isTeamSubscription(sku)) {
            throw new StatusError(403, "Your account does not have a Team subscription");
        } else if (ownerData.subscription_status !== 'active' || ownerData.subscription_expiry < Date.now()) {
            throw new StatusError(403, "Your account does not have an active subscription");
        } else if (ownerData.payment_provider === 'manual') {
            throw new StatusError(400, "Cannot update manually managed subscription. Please contact billing@httptoolkit.tech");
        } else if (ownerData.payment_provider !== 'paddle') {
            throw new StatusError(500, "Cannot update non-Paddle team subscription");
        } else if (!ownerData.team_member_ids) {
            ownerData.team_member_ids = [];
        }

        const { newTeamSize } = JSON.parse(event.body!);
        if (newTeamSize == undefined) throw new StatusError(400, "No subscription quantity specified");
        if (newTeamSize < 1) throw new StatusError(400, "Cannot reduce subscription below 1 license");
        if (newTeamSize === ownerData.subscription_quantity) {
            throw new StatusError(400, "Cannot update subscription to the same number of licenses");
        }

        const currentTeamSize = ownerData.team_member_ids.length;
        if (newTeamSize < currentTeamSize) {
            throw new StatusError(409, "Cannot downgrade subscription below the number of assigned licenses");
        }

        log.info(`For team ${ownerId}: update quantity to ${newTeamSize}`);

        try {
            await updateSubscriptionQuantity(ownerData.subscription_id, newTeamSize, {
                // Upgrades are pro-rated and billed immediately. Downgrades are deferred
                // until the next billing cycle.
                prorate: newTeamSize > currentTeamSize,
                billImmediately: newTeamSize > currentTeamSize
            });
        } catch (e: any) {
            await reportError(e);

            return { statusCode: 500, headers, body: `Subscription update failed: ${e.message || e}` };
        }

        // Wait up to 30 seconds for the payment & webhook to arrive:
        const startTime = Date.now();
        while (Date.now() - startTime < 30_000) {
            const userData = await getUserById(ownerId);
            const ownerData = userData.app_metadata as TeamOwnerMetadata;
            if (ownerData.subscription_quantity === newTeamSize) {
                return { statusCode: 200, headers, body: 'success' };
            }

            await delay(500);
        }

        await reportError(`Payment completed for team size update but no update applied for team ${ownerId}`);
        return { statusCode: 500, headers, body: 'No subscription update received from Paddle before timeout' };
    } catch (e: any) {
        await reportError(e);

        return {
            statusCode: e.statusCode ?? 500,
            headers: { ...headers, 'Cache-Control': 'no-store' },
            body: e.message || e
        }
    }
});