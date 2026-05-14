import {
    expect,
    expectRejection,
    fixtures,
    FIXTURE_NOW,
    getServer,
    readStoredState,
    seedLastJwt,
    seedTokens
} from './setup/harness.js';

import {
    getLastUserData,
    getLatestUserData,
    getUserFromAppJwt
} from '../src/auth.js';

const APP_DATA_PATH = '/get-app-data';

function seedSession(): void {
    seedTokens({
        accessToken: 'tok',
        refreshToken: 'refresh',
        accessTokenExpiry: FIXTURE_NOW + 60 * 60 * 1000
    });
}

describe('getLatestUserData', () => {
    it('parses a signed app JWT into a User', async () => {
        seedSession();
        await getServer().forGet(APP_DATA_PATH).thenReply(200, fixtures.appJwts['app-pro-monthly']);

        const u = await getLatestUserData();

        expect(u.email).to.equal('pro-monthly@example.invalid');
        expect(u.subscription?.sku).to.equal('pro-monthly');
        expect(u.subscription?.status).to.equal('active');
        expect(u.isPaidUser()).to.equal(true);
        expect(u.userHasSubscription()).to.equal(true);
    });

    it('stores the raw JWT in last_jwt on success', async () => {
        seedSession();
        const jwt = fixtures.appJwts['app-pro-monthly'];
        await getServer().forGet(APP_DATA_PATH).thenReply(200, jwt);

        await getLatestUserData();

        expect(readStoredState().lastJwt).to.equal(jwt);
    });

    it('classifies a past_due user as having a subscription but not paid', async () => {
        seedSession();
        await getServer().forGet(APP_DATA_PATH).thenReply(200, fixtures.appJwts['app-past-due']);

        const u = await getLatestUserData();
        expect(u.isPaidUser()).to.equal(false);
        expect(u.isPastDueUser()).to.equal(true);
        expect(u.userHasSubscription()).to.equal(true);
    });

    it('classifies a "deleted but unexpired" user as still paid', async () => {
        seedSession();
        await getServer().forGet(APP_DATA_PATH).thenReply(200, fixtures.appJwts['app-deleted-but-active']);

        const u = await getLatestUserData();
        expect(u.subscription?.status).to.equal('deleted');
        expect(u.isPaidUser()).to.equal(true);
    });

    it('classifies a trialing user as paid', async () => {
        seedSession();
        await getServer().forGet(APP_DATA_PATH).thenReply(200, fixtures.appJwts['app-trialing']);

        const u = await getLatestUserData();
        expect(u.subscription?.status).to.equal('trialing');
        expect(u.isPaidUser()).to.equal(true);
        expect(u.isPastDueUser()).to.equal(false);
    });

    it('surfaces the banned flag', async () => {
        seedSession();
        await getServer().forGet(APP_DATA_PATH).thenReply(200, fixtures.appJwts['app-banned']);

        const u = await getLatestUserData();
        expect(u.banned).to.equal(true);
        expect(u.userHasSubscription()).to.equal(false);
    });

    it('surfaces feature_flags', async () => {
        seedSession();
        await getServer().forGet(APP_DATA_PATH).thenReply(200, fixtures.appJwts['app-feature-flags']);

        const u = await getLatestUserData();
        expect(u.featureFlags).to.deep.equal(['flag-one', 'flag-two']);
    });

    it('parses team_subscription separately from the main subscription for team owners', async () => {
        seedSession();
        await getServer().forGet(APP_DATA_PATH).thenReply(200, fixtures.appJwts['app-team-owner']);

        const u = await getLatestUserData();
        // Owner is not a member of the team they own.
        expect(u.subscription).to.equal(undefined);
        expect(u.userHasSubscription()).to.equal(false);
        expect(u.teamSubscription?.sku).to.equal('team-annual');
        expect(u.teamSubscription?.quantity).to.equal(5);
        expect(u.teamSubscription?.canUpdateTeamSize).to.equal(true);
    });

    it('derives the SKU from the legacy subscription_plan_id when subscription_sku is missing', async () => {
        seedSession();
        await getServer().forGet(APP_DATA_PATH).thenReply(200, fixtures.appJwts['app-legacy-paddle-id']);

        const u = await getLatestUserData();
        // Paddle id 550380 in plans.ts is 'pro-monthly'.
        expect(u.subscription?.sku).to.equal('pro-monthly');
        expect(u.subscription?.tierCode).to.equal('pro');
        expect(u.subscription?.interval).to.equal('monthly');
        expect(u.isPaidUser()).to.equal(true);
    });

    it('falls back to cached last_jwt when the server fetch fails', async () => {
        seedSession();
        seedLastJwt(fixtures.appJwts['app-pro-monthly']);
        await getServer().forGet(APP_DATA_PATH).thenReply(500);

        const u = await getLatestUserData();
        expect(u.email).to.equal('pro-monthly@example.invalid');
    });

    it('returns the anonymous user when fetch fails and last_jwt is missing', async () => {
        seedSession();
        await getServer().forGet(APP_DATA_PATH).thenReply(500);

        const u = await getLatestUserData();
        expect(u.email).to.equal(undefined);
        expect(u.userHasSubscription()).to.equal(false);
    });

    it('returns the anonymous user (rather than throwing) when auth is explicitly rejected', async () => {
        seedTokens({
            accessToken: 'tok',
            refreshToken: 'revoked',
            accessTokenExpiry: FIXTURE_NOW + 60 * 60 * 1000
        });
        seedLastJwt(fixtures.appJwts['app-pro-monthly']);

        await getServer().forGet(APP_DATA_PATH).thenReply(401);
        await getServer().forPost('/auth/refresh-token').thenReply(403);

        const u = await getLatestUserData();
        expect(u.email).to.equal(undefined);

        expect(readStoredState().tokens).to.equal(null);
    });

    it('returns the anonymous user when there are no tokens at all', async () => {
        const u = await getLatestUserData();
        expect(u.email).to.equal(undefined);
    });
});

describe('getLastUserData', () => {
    it('returns the cached user without hitting the network', async () => {
        seedLastJwt(fixtures.appJwts['app-pro-monthly']);

        const u = getLastUserData();
        expect(u.email).to.equal('pro-monthly@example.invalid');
        expect(u.isPaidUser()).to.equal(true);
    });

    it('returns the anonymous user when there is no cached JWT', async () => {
        const u = getLastUserData();
        expect(u.email).to.equal(undefined);
    });

    it('clears last_jwt asynchronously if the cached JWT fails signature verification', async () => {
        // wrongAudienceAppJwt decodes fine and has a future exp, so it
        // survives the synchronous checks; the async signature verification
        // then rejects it (wrong audience) and clears the cache.
        seedLastJwt(fixtures.wrongAudienceAppJwt);

        getLastUserData();

        // Give the async re-verification a moment to settle.
        await new Promise((r) => setTimeout(r, 200));

        expect(readStoredState().lastJwt).to.equal(null);
    });
});

describe('getUserFromAppJwt', () => {
    it('parses a valid signed JWT into a User', async () => {
        const u = await getUserFromAppJwt(fixtures.appJwts['app-team-member']);
        expect(u.email).to.equal('team-member@example.invalid');
        expect(u.subscription?.sku).to.equal('team-annual');
    });

    it('rejects an unsigned / invalid JWT', async () => {
        await expectRejection(getUserFromAppJwt('not.a.real.jwt'));
    });

    it('rejects a JWT signed for a different audience', async () => {
        await expectRejection(getUserFromAppJwt(fixtures.wrongAudienceAppJwt));
    });
});
