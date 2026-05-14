// Exercises requestUserData()'s 401 -> refresh -> retry path via getBillingData.
// The JWT response bodies are deliberately unparseable here - the retry
// behaviour is fully observable from mockttp.

import {
    expect,
    expectRejection,
    FIXTURE_NOW,
    getServer,
    readStoredState,
    seedTokens
} from './setup/harness.js';

import { AuthRejectedError, getBillingData } from '../src/auth.js';

const REFRESH_PATH = '/auth/refresh-token';
const BILLING_PATH = '/get-billing-data';

describe('requestUserData 401 retry', () => {
    it('refreshes the access token and retries once when the first request returns 401', async () => {
        seedTokens({
            accessToken: 'initial',
            refreshToken: 'refresh-1',
            accessTokenExpiry: FIXTURE_NOW + 60 * 60 * 1000
        });

        const firstAttempt = await getServer().forGet(BILLING_PATH)
            .withHeaders({ authorization: 'Bearer initial' })
            .thenReply(401, 'token expired upstream');
        const refresh = await getServer().forPost(REFRESH_PATH).thenJson(200, {
            accessToken: 'refreshed',
            expiresAt: FIXTURE_NOW + 60 * 60 * 1000
        });
        const retryAttempt = await getServer().forGet(BILLING_PATH)
            .withHeaders({ authorization: 'Bearer refreshed' })
            .thenReply(200, 'not-actually-a-jwt');

        await getBillingData().catch(() => {});

        expect(await firstAttempt.getSeenRequests()).to.have.lengthOf(1);
        expect(await refresh.getSeenRequests()).to.have.lengthOf(1);
        expect(await retryAttempt.getSeenRequests()).to.have.lengthOf(1);
    });

    it('throws AuthRejectedError if the retry also returns 401, without a third attempt', async () => {
        seedTokens({
            accessToken: 'initial',
            refreshToken: 'refresh-1',
            accessTokenExpiry: FIXTURE_NOW + 60 * 60 * 1000
        });

        await getServer().forGet(BILLING_PATH)
            .withHeaders({ authorization: 'Bearer initial' })
            .thenReply(401);
        await getServer().forPost(REFRESH_PATH).thenJson(200, {
            accessToken: 'refreshed',
            expiresAt: FIXTURE_NOW + 60 * 60 * 1000
        });
        const retryAttempt = await getServer().forGet(BILLING_PATH)
            .withHeaders({ authorization: 'Bearer refreshed' })
            .thenReply(401);

        await expectRejection(getBillingData(), AuthRejectedError);

        // Only one retry - the second 401 doesn't trigger another refresh.
        expect(await retryAttempt.getSeenRequests()).to.have.lengthOf(1);

        // Tokens are not cleared - the refresh succeeded; only an explicit
        // 403 from the refresh endpoint logs the user out.
        expect(readStoredState().tokens?.refreshToken).to.equal('refresh-1');
    });

    it('throws AuthRejectedError immediately on 401 when there is no refresh token', async () => {
        seedTokens({
            accessToken: 'initial',
            accessTokenExpiry: FIXTURE_NOW + 60 * 60 * 1000
            // no refreshToken
        });

        const billing = await getServer().forGet(BILLING_PATH).thenReply(401);
        const refresh = await getServer().forPost(REFRESH_PATH).thenReply(200);

        await expectRejection(getBillingData(), AuthRejectedError);

        expect(await billing.getSeenRequests()).to.have.lengthOf(1);
        expect(await refresh.getSeenRequests()).to.have.lengthOf(0);
    });

    it('clears tokens and throws AuthRejectedError when the recovery refresh returns 403', async () => {
        seedTokens({
            accessToken: 'initial',
            refreshToken: 'revoked',
            accessTokenExpiry: FIXTURE_NOW + 60 * 60 * 1000
        });

        await getServer().forGet(BILLING_PATH).thenReply(401);
        await getServer().forPost(REFRESH_PATH).thenReply(403);

        await expectRejection(getBillingData(), AuthRejectedError);

        expect(readStoredState().tokens).to.equal(null);
    });
});
