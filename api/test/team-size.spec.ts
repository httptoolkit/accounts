import { expect } from 'chai';

import { StatusError } from '../src/errors.ts';
import {
    assertUpdatableTeamSubscription,
    getMinTeamSize,
    getRenewalQuantity,
    planTeamSizeChange
} from '../src/team-size.ts';
import type { PaddleSubscription } from '../src/paddle.ts';
import type { TeamOwnerMetadata } from '../src/user-data-facade.ts';

const givenTeam = (overrides: Partial<TeamOwnerMetadata> = {}): TeamOwnerMetadata => ({
    subscription_status: 'active',
    subscription_sku: 'team-annual',
    subscription_expiry: Date.now() + 1000 * 60 * 60 * 24,
    subscription_id: '2',
    subscription_quantity: 10,
    payment_provider: 'paddle',
    update_url: 'uu',
    cancel_url: 'cu',
    team_member_ids: ['a', 'b', 'c', 'd'],
    locked_licenses: [],
    ...overrides
});

const expectStatus = (fn: () => unknown, statusCode: number) => {
    try {
        fn();
    } catch (e) {
        if (!(e instanceof StatusError)) throw new Error(`Expected a StatusError, got ${e}`);
        expect(e.statusCode).to.equal(statusCode);
        return;
    }
    expect.fail(`Expected a ${statusCode} error`);
};

describe('Team size changes', () => {

    describe('eligibility', () => {

        it("accepts an active Paddle team, returning its SKU", () => {
            expect(assertUpdatableTeamSubscription(givenTeam())).to.equal('team-annual');
        });

        it("rejects non-team subscriptions", () => {
            expectStatus(() => assertUpdatableTeamSubscription(
                givenTeam({ subscription_sku: 'pro-annual' })
            ), 403);
        });

        it("rejects inactive subscriptions", () => {
            expectStatus(() => assertUpdatableTeamSubscription(
                givenTeam({ subscription_status: 'past_due' })
            ), 403);
        });

        it("rejects manual and non-Paddle subscriptions", () => {
            expectStatus(() => assertUpdatableTeamSubscription(
                givenTeam({ payment_provider: 'manual' })
            ), 400);
            expectStatus(() => assertUpdatableTeamSubscription(
                givenTeam({ payment_provider: 'paypro' })
            ), 500);
        });

        it("rejects a subscription with no usable quantity", () => {
            expectStatus(() => assertUpdatableTeamSubscription(
                givenTeam({ subscription_quantity: NaN })
            ), 500);
        });

    });

    describe('limits', () => {

        it("sets the minimum by assigned members, ignoring locked licenses", () => {
            expect(getMinTeamSize(givenTeam({ locked_licenses: [Date.now()] }))).to.equal(4);
        });

        it("never sets a minimum below one license", () => {
            expect(getMinTeamSize(givenTeam({ team_member_ids: [] }))).to.equal(1);
        });

        it("reads the renewal quantity from Paddle's subscription data", () => {
            const subscription: PaddleSubscription = {
                subscription_id: 2, user_id: 1, plan_id: 550788, state: 'active', quantity: 7
            };
            expect(getRenewalQuantity(subscription)).to.equal(7);
            expectStatus(() => getRenewalQuantity({ ...subscription, quantity: undefined }), 502);
            expectStatus(() => getRenewalQuantity(undefined), 502);
        });

    });

    describe('planning', () => {

        it("pro-rates and bills an upgrade immediately", () => {
            const plan = planTeamSizeChange(givenTeam(), 10, 12);

            expect(plan.isUpgrade).to.equal(true);
            expect(plan.paddleUpdates).to.deep.equal([
                { quantity: 12, prorate: true, billImmediately: true }
            ]);
        });

        it("defers a downgrade until renewal", () => {
            const plan = planTeamSizeChange(givenTeam(), 10, 6);

            expect(plan.isUpgrade).to.equal(false);
            expect(plan.paddleUpdates).to.deep.equal([
                { quantity: 6, prorate: false, billImmediately: false }
            ]);
        });

        it("restores the paid quantity before an upgrade while a reduction is pending", () => {
            // 10 paid for, but Paddle is set to renew at 6:
            expect(planTeamSizeChange(givenTeam(), 6, 12).paddleUpdates).to.deep.equal([
                { quantity: 10, prorate: false, billImmediately: false },
                { quantity: 12, prorate: true, billImmediately: true }
            ]);
        });

        it("cancels a pending reduction without charging", () => {
            expect(planTeamSizeChange(givenTeam(), 6, 10).paddleUpdates).to.deep.equal([
                { quantity: 10, prorate: false, billImmediately: false }
            ]);
        });

        it("changes a pending reduction without charging", () => {
            expect(planTeamSizeChange(givenTeam(), 6, 8).paddleUpdates).to.deep.equal([
                { quantity: 8, prorate: false, billImmediately: false }
            ]);
        });

        it("rejects a size that's already scheduled for renewal", () => {
            expectStatus(() => planTeamSizeChange(givenTeam(), 10, 10), 400);
            expectStatus(() => planTeamSizeChange(givenTeam(), 6, 6), 400);
        });

        it("rejects changes while an upgrade is still arriving from Paddle", () => {
            expectStatus(() => planTeamSizeChange(givenTeam(), 12, 14), 409);
        });

        it("rejects downgrades below the assigned members", () => {
            expectStatus(() => planTeamSizeChange(givenTeam(), 10, 3), 409);
        });

        it("allows downgrades below the locked licenses", () => {
            const team = givenTeam({
                subscription_quantity: 2,
                team_member_ids: ['a'],
                locked_licenses: [Date.now()]
            });

            expect(planTeamSizeChange(team, 2, 1).paddleUpdates).to.deep.equal([
                { quantity: 1, prorate: false, billImmediately: false }
            ]);
        });

        it("rejects invalid sizes", () => {
            expectStatus(() => planTeamSizeChange(givenTeam(), 10, 4.5), 400);
            expectStatus(() => planTeamSizeChange(givenTeam(), 10, NaN), 400);
            expectStatus(() => planTeamSizeChange(givenTeam(), 10, 0), 400);
            expectStatus(() => planTeamSizeChange(givenTeam(), 10, 100_000), 400);
        });

    });

});
