import {
    expect,
    expectRejection,
    fixtures,
    FIXTURE_NOW,
    getServer,
    seedTokens
} from './setup/harness.js';

import { getBillingData } from '../src/auth.js';

const BILLING_PATH = '/get-billing-data';

function seedSession(): void {
    seedTokens({
        accessToken: 'tok',
        refreshToken: 'r',
        accessTokenExpiry: FIXTURE_NOW + 60 * 60 * 1000
    });
}

describe('getBillingData', () => {
    it('parses a billing JWT with a transactions list', async () => {
        seedSession();
        await getServer().forGet(BILLING_PATH).thenReply(200, fixtures.billingJwts['billing-pro-with-transactions']);

        const b = await getBillingData();

        expect(b.email).to.equal('pro-monthly@example.invalid');
        expect(b.transactions).to.have.lengthOf(2);
        expect(b.transactions?.[0]).to.deep.equal({
            orderId: 'order-1',
            receiptUrl: 'https://example.invalid/r1',
            sku: 'pro-monthly',
            createdAt: '2023-10-01T00:00:00Z',
            status: 'completed',
            currency: 'USD',
            amount: '7.00'
        });
    });

    it('parses team owner data with members and locked-license expiries', async () => {
        seedSession();
        await getServer().forGet(BILLING_PATH).thenReply(200, fixtures.billingJwts['billing-team-owner']);

        const b = await getBillingData();

        expect(b.teamMembers).to.have.lengthOf(2);
        expect(b.teamMembers?.find((m) => m.locked)?.id).to.equal('member-2');
        expect(b.lockedLicenseExpiries).to.have.lengthOf(1);
        expect(b.subscription?.canUpdateTeamSize).to.equal(true);
        expect(b.subscription?.quantity).to.equal(5);
    });

    it('parses team-member billing data with the team owner block', async () => {
        seedSession();
        await getServer().forGet(BILLING_PATH).thenReply(200, fixtures.billingJwts['billing-team-member']);

        const b = await getBillingData();

        expect(b.teamOwner?.id).to.equal('test-user-team-owner');
        expect(b.transactions).to.equal(null);
        expect(b.subscription?.canManageSubscription).to.equal(false);
    });

    it('propagates server errors instead of falling back to an anon user', async () => {
        seedSession();
        await getServer().forGet(BILLING_PATH).thenReply(500);

        const err = await expectRejection(getBillingData());
        expect(err.message).to.include('Failed to load billing data');
    });
});
