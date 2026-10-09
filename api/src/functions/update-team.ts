import { initSentry, catchErrors, reportError } from '../errors.ts';
initSentry();

import { getAuth0UserIdFromToken } from '../user-data-facade.ts';
import { getCorsResponseHeaders } from '../cors.ts';
import { TeamMembershipChanges, updateTeamMembership } from '../team-membership.ts';

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
        const ownerId = await getAuth0UserIdFromToken(accessToken);
        const input: TeamMembershipChanges = JSON.parse(event.body!);

        await updateTeamMembership(ownerId, input);

        return { statusCode: 200, headers, body: 'success' };
    } catch (e: any) {
        await reportError(e);

        return {
            statusCode: e.statusCode ?? 500,
            headers: { ...headers, 'Cache-Control': 'no-store' },
            body: e.message
        }
    }
});
