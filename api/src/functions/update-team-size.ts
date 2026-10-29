import log from 'loglevel';

import { initSentry, catchErrors, reportError, StatusError } from '../errors.ts';
initSentry();

import { getCorsResponseHeaders } from '../cors.ts';
import {
    TeamOwnerMetadata,
    getAuth0UserIdFromToken,
    getUserById
} from '../user-data-facade.ts';
import {
    assertUpdatableTeamSubscription,
    getRenewalQuantity,
    planTeamSizeChange
} from '../team-size.ts';
import { applyTeamSizeChange } from '../team-size-updates.ts';
import { getPaddleSubscription } from '../paddle.ts';

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
        const ownerId = await getAuth0UserIdFromToken(accessToken);
        const ownerData = (await getUserById(ownerId)).app_metadata as TeamOwnerMetadata;
        assertUpdatableTeamSubscription(ownerData);

        const { newTeamSize } = JSON.parse(event.body!);
        if (newTeamSize == undefined) throw new StatusError(400, "No subscription quantity specified");
        if (typeof newTeamSize !== 'number') {
            throw new StatusError(400, `Subscription quantity must be a number (was ${newTeamSize})`);
        }

        const subscription = await getPaddleSubscription(ownerData.subscription_id);
        const plan = planTeamSizeChange(ownerData, getRenewalQuantity(subscription), newTeamSize);

        log.info(`For team ${ownerId}: update quantity from ${plan.paidQuantity} (${
            plan.renewalQuantity
        } at renewal) to ${newTeamSize}`);

        try {
            await applyTeamSizeChange(ownerId, ownerData.subscription_id, plan);
        } catch (e: any) {
            await reportError(e);
            return { statusCode: 500, headers, body: `Subscription update failed: ${e.message || e}` };
        }

        return { statusCode: 200, headers, body: 'success' };
    } catch (e: any) {
        await reportError(e);

        return {
            statusCode: e.statusCode ?? 500,
            headers: { ...headers, 'Cache-Control': 'no-store' },
            body: e.message || e
        }
    }
});