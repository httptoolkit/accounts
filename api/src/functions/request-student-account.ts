import log from 'loglevel';

import { initSentry, catchErrors, StatusError } from '../errors.ts';
initSentry();

import { getCorsResponseHeaders } from '../cors.ts';
import {
    getAuth0UserIdFromToken,
    getUserById,
    updateUserMetadata,
    TrialUserMetadata
} from '../user-data-facade.ts';
import { isAcademic } from 'educhk';


const BearerRegex = /^Bearer (\S+)$/;

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const TWO_MONTHS_MS = 60 * 24 * 60 * 60 * 1000;

/*
This endpoint expects requests to be sent with a Bearer authorization,
containing a valid access token for the Auth0 app.

If the token is valid, the user's email domain is checked with educhk.
If it's a recognized academic email, the user is granted a free Pro trial
for one year (renewable within 2 months of expiry).
If the email is not academic, a 403 is returned with a structured error body
so the frontend can show a fallback contact form.
*/
export const handler = catchErrors(async (event) => {
    let headers = getCorsResponseHeaders(event);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    } else if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: '' };
    }

    const { authorization } = event.headers;

    const tokenMatch = BearerRegex.exec(authorization);
    if (!tokenMatch) return { statusCode: 401, headers, body: '' };
    const accessToken = tokenMatch[1];

    const userId = await getAuth0UserIdFromToken(accessToken);
    const user = await getUserById(userId);

    if (!user.email) {
        throw new StatusError(400, 'No email address associated with this account');
    }

    const email = user.email;

    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (!emailDomain || !isAcademic(emailDomain)) {
        log.info(`Student account rejected for non-academic email: ${email}`);
        return {
            statusCode: 403,
            headers,
            body: JSON.stringify({
                error: 'not_academic',
                message: `The email address ${email} is not recognized as an academic email address. ` +
                    'If you believe this is incorrect, please contact support.'
            })
        };
    }

    const existingMeta = user.app_metadata as Partial<TrialUserMetadata> & { payment_provider?: string };
    const existingExpiry = existingMeta.subscription_expiry;

    const hasActiveStudentSub =
        existingMeta.subscription_status === 'trialing' &&
        existingMeta.payment_provider === 'student-account' &&
        existingExpiry &&
        existingExpiry > Date.now() + TWO_MONTHS_MS;

    if (hasActiveStudentSub) {
        return {
            statusCode: 409,
            headers,
            body: JSON.stringify({
                error: 'already_active',
                message: 'You already have an active student subscription. ' +
                    'You can renew when less than 2 months remain.',
                expiry: existingMeta.subscription_expiry
            })
        };
    } else if (existingMeta.subscription_status === 'active') {
        return {
            statusCode: 409,
            headers,
            body: JSON.stringify({
                error: 'paid_account',
                message: 'You have an active paid subscription. ' +
                    'Please cancel your existing subscription first, and try again.',
                expiry: existingMeta.subscription_expiry
            })
        };
    }

    const school = emailDomain;
    const expiry = Date.now() + ONE_YEAR_MS;

    await updateUserMetadata(userId, {
        subscription_status: 'trialing',
        payment_provider: 'student-account',
        subscription_sku: 'pro-annual',
        subscription_quantity: 1,
        subscription_expiry: expiry
    });

    log.info(`Student account granted for ${email}` +
        (school ? ` (${school})` : '') +
        `, expires ${new Date(expiry).toISOString()}`
    );

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
            success: true,
            school,
            expiry
        })
    };
});
