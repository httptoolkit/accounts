// Exercises getToken() + refreshToken() via cancelSubscription, the simplest
// exported call that takes a token but doesn't need a signed JWT response.

import {
    expect,
    expectRejection,
    FIXTURE_NOW,
    getServer,
    readStoredState,
    seedTokens
} from './setup/harness.js';

import { AuthRejectedError, cancelSubscription } from '../src/auth.js';

const REFRESH_PATH = '/auth/refresh-token';
const CANCEL_PATH = '/cancel-subscription';

describe('getToken / refreshToken', () => {
    it('uses the current access token without refreshing when expiry is > 10 minutes away', async () => {
        seedTokens({
            accessToken: 'fresh-access',
            refreshToken: 'fresh-refresh',
            accessTokenExpiry: FIXTURE_NOW + 60 * 60 * 1000 // 1 hour
        });

        const cancel = await getServer().forPost(CANCEL_PATH).thenReply(200);
        const refresh = await getServer().forPost(REFRESH_PATH).thenReply(200, '{}');

        await cancelSubscription();

        const cancelSeen = await cancel.getSeenRequests();
        expect(cancelSeen).to.have.lengthOf(1);
        expect(cancelSeen[0].headers.authorization).to.equal('Bearer fresh-access');
        expect(await refresh.getSeenRequests()).to.have.lengthOf(0);
    });

    it('refreshes in the background but still returns the current token when expiry is < 10 minutes but > 5 seconds away', async () => {
        seedTokens({
            accessToken: 'soon-stale',
            refreshToken: 'still-valid-refresh',
            accessTokenExpiry: FIXTURE_NOW + 5 * 60 * 1000 // 5 minutes
        });

        const cancel = await getServer().forPost(CANCEL_PATH).thenReply(200);
        const refresh = await getServer().forPost(REFRESH_PATH).thenJson(200, {
            accessToken: 'newly-refreshed',
            expiresAt: FIXTURE_NOW + 60 * 60 * 1000
        });

        await cancelSubscription();

        // Cancel used the old token; refresh was fired in parallel.
        const cancelSeen = await cancel.getSeenRequests();
        expect(cancelSeen).to.have.lengthOf(1);
        expect(cancelSeen[0].headers.authorization).to.equal('Bearer soon-stale');

        const refreshSeen = await refresh.getSeenRequests();
        expect(refreshSeen).to.have.lengthOf(1);
        const refreshBody = await refreshSeen[0].body.getJson() as { refreshToken: string };
        expect(refreshBody).to.deep.equal({ refreshToken: 'still-valid-refresh' });

        // A second call lets the background refresh settle behind the mutex
        // before we inspect persisted state.
        await cancelSubscription();
        expect(readStoredState().tokens?.accessToken).to.equal('newly-refreshed');
    });

    it('awaits the refresh when the access token is within 5 seconds of expiry', async () => {
        seedTokens({
            accessToken: 'about-to-die',
            refreshToken: 'good-refresh',
            accessTokenExpiry: FIXTURE_NOW - 1000 // already expired
        });

        const cancel = await getServer().forPost(CANCEL_PATH).thenReply(200);
        await getServer().forPost(REFRESH_PATH).thenJson(200, {
            accessToken: 'post-refresh-access',
            expiresAt: FIXTURE_NOW + 60 * 60 * 1000
        });

        await cancelSubscription();

        const cancelSeen = await cancel.getSeenRequests();
        expect(cancelSeen).to.have.lengthOf(1);
        expect(cancelSeen[0].headers.authorization).to.equal('Bearer post-refresh-access');
    });

    it('logs out and surfaces "no token" when the access token is expired and there is no refresh token', async () => {
        seedTokens({
            accessToken: 'expired',
            accessTokenExpiry: FIXTURE_NOW - 1000
            // no refreshToken
        });

        const refresh = await getServer().forPost(REFRESH_PATH).thenReply(200);

        const err = await expectRejection(cancelSubscription());
        expect(err.message).to.include("Can't cancel account without an auth token");

        expect(await refresh.getSeenRequests()).to.have.lengthOf(0);
        expect(readStoredState().tokens).to.equal(null);
    });

    it('logs out and throws AuthRejectedError when refresh returns 403', async () => {
        seedTokens({
            accessToken: 'expired',
            refreshToken: 'revoked-refresh',
            accessTokenExpiry: FIXTURE_NOW - 1000
        });

        await getServer().forPost(REFRESH_PATH).thenReply(403);
        const cancel = await getServer().forPost(CANCEL_PATH).thenReply(200);

        await expectRejection(cancelSubscription(), AuthRejectedError);

        expect(readStoredState().tokens).to.equal(null);
        expect(await cancel.getSeenRequests()).to.have.lengthOf(0);
    });

    it('does NOT log out on a non-403 refresh failure', async () => {
        const initialTokens = {
            accessToken: 'expired',
            refreshToken: 'still-good',
            accessTokenExpiry: FIXTURE_NOW - 1000
        };
        seedTokens(initialTokens);

        await getServer().forPost(REFRESH_PATH).thenReply(500);
        await getServer().forPost(CANCEL_PATH).thenReply(200);

        const err = await expectRejection(cancelSubscription());
        expect(err.constructor.name).to.equal('Error');
        expect(err.message).to.include('Failed to refresh token');

        expect(readStoredState().tokens).to.deep.equal(initialTokens);
    });

    it('queued callers see no tokens after a 403-driven logout', async () => {
        seedTokens({
            accessToken: 'expired',
            refreshToken: 'revoked',
            accessTokenExpiry: FIXTURE_NOW - 1000
        });

        await getServer().forPost(REFRESH_PATH).thenReply(403);
        const cancel = await getServer().forPost(CANCEL_PATH).thenReply(200);

        // Both calls race through tokenMutex: the first drives the refresh
        // and gets AuthRejectedError; the second runs once tokens are cleared
        // and gets the generic "no token" error.
        const [first, second] = await Promise.allSettled([
            cancelSubscription(),
            cancelSubscription()
        ]);

        expect(first.status).to.equal('rejected');
        expect(second.status).to.equal('rejected');
        const errorNames = [first, second]
            .map((r) => r.status === 'rejected' ? (r.reason as Error).constructor.name : '')
            .sort();
        expect(errorNames).to.deep.equal(['AuthRejectedError', 'Error']);

        expect(await cancel.getSeenRequests()).to.have.lengthOf(0);
    });
});
