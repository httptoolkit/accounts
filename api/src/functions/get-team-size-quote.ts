import log from 'loglevel';
import { asErrorLike } from '@httptoolkit/util';

import { initSentry, catchErrors, reportError, StatusError } from '../errors.ts';
initSentry();

import { getCorsResponseHeaders } from '../cors.ts';
import { getSkuInterval } from '../products.ts';
import { getBillingPeriod } from '../proration.ts';
import {
    TeamOwnerMetadata,
    getAuth0UserIdFromToken,
    getUserById
} from '../user-data-facade.ts';
import {
    MAX_TEAM_SIZE,
    assertNoPendingIncrease,
    assertUpdatableTeamSubscription,
    getMinTeamSize,
    getRenewalQuantity
} from '../team-size.ts';
import { getPaddleSubscription, getSubscriptionPricing } from '../paddle.ts';

const BearerRegex = /^Bearer (\S+)$/;

/**
 * This endpoint expects requests to be sent with a Bearer authorization,
 * containing a valid access token for the Auth0 app.
 *
 * Returns the data needed to quote any team size change (unit price, size limits, and
 * billing period details) so callers can calculate quotes locally.
*/
export const handler = catchErrors(async (event) => {
    let headers = getCorsResponseHeaders(event);

    if (event.httpMethod !== 'OPTIONS') {
        // Never cached: a quote is only requested when somebody opens the controls, and
        // replaying a stale one straight after a change would quote against the previous
        // quantity and then be rejected on submission.
        headers['Cache-Control'] = 'no-store';
    }

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    } else if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: '' };
    }

    const { authorization } = event.headers;

    const tokenMatch = BearerRegex.exec(authorization);
    if (!tokenMatch) return { statusCode: 401, headers, body: '' };
    const accessToken = tokenMatch[1];

    try {
        const ownerId = await getAuth0UserIdFromToken(accessToken);
        const ownerData = (await getUserById(ownerId)).app_metadata as TeamOwnerMetadata;
        const sku = assertUpdatableTeamSubscription(ownerData);

        const subscription = await getPaddleSubscription(ownerData.subscription_id);
        if (!subscription) {
            throw new StatusError(502, "Could not load your subscription from the payment provider");
        }

        const renewalQuantity = getRenewalQuantity(subscription);
        // No updates until we get the webhook from any past update:
        assertNoPendingIncrease(ownerData, renewalQuantity);

        const interval = getSkuInterval(sku);
        const { currency, unitPrice, nextBillDate } = getSubscriptionPricing(subscription);
        const billingPeriod = getBillingPeriod(nextBillDate, interval);

        log.info(`Quoted team ${ownerId} at ${unitPrice} ${currency} per license, ${
            billingPeriod.daysRemaining
        }/${billingPeriod.daysInPeriod} days remaining`);

        return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currency,
                unit_price: unitPrice,
                current_quantity: ownerData.subscription_quantity,
                renewal_quantity: renewalQuantity,
                min_quantity: getMinTeamSize(ownerData),
                max_quantity: MAX_TEAM_SIZE,
                interval,
                next_bill_date: billingPeriod.nextBillDate,
                days_in_period: billingPeriod.daysInPeriod,
                days_remaining: billingPeriod.daysRemaining
            })
        };
    } catch (e) {
        await reportError(e instanceof Error ? e : String(e));
        const error = asErrorLike(e);

        return {
            statusCode: error.statusCode ?? 500,
            headers,
            body: error.message ?? 'Unknown error'
        };
    }
});
