import { initSentry, catchErrors, reportError } from '../errors';
initSentry();

import { APIGatewayProxyEvent } from 'aws-lambda';
import * as jwt from 'jsonwebtoken';

import { AUTH0_DATA_SIGNING_PRIVATE_KEY, authClient, mgmtClient } from '../auth0';
import { TEAM_SUBSCRIPTION_IDS } from '../paddle';
import { getCorsResponseHeaders } from '../cors';

const BearerRegex = /^Bearer (\S+)$/;

// A cache to avoid hitting userinfo unnecessarily.
const tokenIdCache: { [accessToken: string]: string } = {};

async function getUserData(accessToken: string) {
    let userId = tokenIdCache[accessToken];

    if (userId) {
        console.log(`Matched token to user id ${userId} from cache`);
    } else {
        // getProfile is only minimal data, updated at last login (/userinfo - 5 req/minute/user)
        const user: { sub: string } | undefined = await authClient.getProfile(accessToken);

        if (!user) {
            throw new Error("User could not be found in get-app-data");
        } else if (typeof user.sub !== 'string') {
            console.log(JSON.stringify(user));
            throw new Error(`Unexpected getProfile result: ${user}`);
        }

        userId = tokenIdCache[accessToken] = user.sub;

        console.log(`Looked up user id ${userId} from token`);
    }

    // getUser is full live data for the user (/users/{id} - 15 req/second)
    const userData = await mgmtClient.getUser({ id: userId });

    let userMetadata = userData.app_metadata;

    if (userMetadata && TEAM_SUBSCRIPTION_IDS.includes(userMetadata.subscription_plan_id)) {
        // If you have a team subscription, you're the *owner* of a team, not a member.
        // That means your subscription data isn't actually for *you*, it's for
        // the actual team members. Move it into a separate team_subscription to make that clear.
        userMetadata.team_subscription = {};
        [
            "subscription_status",
            "subscription_id",
            "subscription_plan_id",
            "subscription_expiry",
            "subscription_quantity",
            "last_receipt_url",
            "update_url",
            "cancel_url",
            "team_member_ids"
        ].forEach((key: string) => {
            userMetadata!.team_subscription[key] = userMetadata![key];
            delete userMetadata![key];
        }, {});
    }

    if (userMetadata && userMetadata.subscription_owner_id) {
        // If there's a subscription owner for this user (e.g. they're a member of a team)
        // copy the basic subscription details from the real owner across to this user.
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
                [
                    'subscription_id',
                    'subscription_status',
                    'subscription_expiry',
                    'subscription_plan_id'
                ].forEach((field) => {
                    userMetadata![field] = subOwnerMetadata[field];
                });
            } else {
                reportError(`Inconsistent team membership for ${userId}`);
                delete userMetadata.subscription_owner_id;
            }
        }
    }

    return {
        email: userData.email,
        ...userMetadata
    };
}

/*
This endpoint expects requests to be sent with a Bearer authorization,
containing a valid access token for the Auth0 app.

If the token is found and is usable, the user's app data (email, subscription
status & feature flags) are loaded and signed into a JWT, so the app can
read that info, and confirm its validity.
*/
export const handler = catchErrors(async (event: APIGatewayProxyEvent) => {
    let headers = getCorsResponseHeaders(event);

    if (event.httpMethod !== 'OPTIONS') {
        // Very briefly cache results, to avoid completely unnecessary calls
        headers['Cache-Control'] = 'private, max-age=10';
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
    const userData = await getUserData(accessToken);

    const signedAppData = jwt.sign(userData, AUTH0_DATA_SIGNING_PRIVATE_KEY, {
        algorithm: 'RS256',
        expiresIn: '7d',
        audience: 'https://httptoolkit.tech/app_data',
        issuer: 'https://httptoolkit.tech/'
    });

    headers['Content-Type'] = 'application/jwt';

    return {
        statusCode: 200,
        headers,
        body: signedAppData
    };
});