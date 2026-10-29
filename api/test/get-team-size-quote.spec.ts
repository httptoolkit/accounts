import _ from 'lodash';
import * as net from 'net';
import moment from 'moment';
import { DestroyableServer } from 'destroyable-server';

import { expect } from 'chai';

import {
    startAPI,
    freshAuthToken,
    givenTeam,
    givenAuthToken,
    givenUser
} from './test-setup/setup.ts';
import {
    paddleServer,
    givenPaddleSubscription,
    PADDLE_PORT,
} from './test-setup/paddle.ts';
import { auth0Server } from './test-setup/auth0.ts';

import { MAX_TEAM_SIZE } from '../src/team-size.ts';

const getTeamSizeQuote = (server: net.Server, authToken: string | undefined) => fetch(
    `http://localhost:${(server.address() as net.AddressInfo).port}/api/get-team-size-quote`,
    {
        method: 'GET',
        headers: {
            ...(authToken
                ? { Authorization: `Bearer ${authToken}` }
                : {}
            )
        }
    }
);

// About ten days out, so days_remaining is predictable regardless of when tests run. Month
// ends are skipped, as their period start is only estimated (see getBillingPeriod).
const nextBillDate = () => {
    const date = moment.utc().startOf('day').add(10, 'days');
    if (date.date() === date.daysInMonth()) date.add(1, 'day');
    return date.format('YYYY-MM-DD');
};

describe('/get-team-size-quote', () => {

    let apiServer: DestroyableServer;

    beforeEach(async () => {
        apiServer = await startAPI();
        await paddleServer.start(PADDLE_PORT);
    });

    afterEach(async () => {
        await apiServer.destroy();
        await paddleServer.stop();
    });

    describe("for unauthed users", () => {
        it("returns 401", async () => {
            const response = await getTeamSizeQuote(apiServer, undefined);
            expect(response.status).to.equal(401);
        });
    });

    describe("for free users", () => {
        it("returns 403", async () => {
            const authToken = freshAuthToken();
            await givenUser("abc", 'user@example.com');
            await givenAuthToken(authToken, "abc");
            await auth0Server.forGet('/api/v2/users').thenJson(200, []);

            const response = await getTeamSizeQuote(apiServer, authToken);
            expect(response.status).to.equal(403);
        });
    });

    describe("for Pro users", () => {
        it("returns 403", async () => {
            const authToken = freshAuthToken();
            await givenUser("abc", 'user@example.com', {
                payment_provider: 'paddle',
                subscription_expiry: Date.now() + 60_000,
                subscription_id: '2',
                subscription_sku: 'pro-monthly',
                subscription_status: "active"
            });
            await givenAuthToken(authToken, "abc");
            await auth0Server.forGet('/api/v2/users').thenJson(200, []);

            const response = await getTeamSizeQuote(apiServer, authToken);
            expect(response.status).to.equal(403);
        });
    });

    describe("for Team users", () => {

        const givenFourMemberTeam = (spaces = 0) => givenTeam([
            ..._.range(4).map((i) => ({ id: i.toString(), email: `member${i}@example.com` })),
            ..._.range(spaces).map(() => undefined)
        ]);

        it("quotes the tax-inclusive unit price from the next payment", async () => {
            const billDate = nextBillDate();
            const { ownerAuthToken } = await givenFourMemberTeam(1); // 5 licenses
            await givenPaddleSubscription(2, {
                quantity: 5,
                next_payment: { amount: 69, currency: 'GBP', date: billDate }
            });

            const response = await getTeamSizeQuote(apiServer, ownerAuthToken);
            expect(response.status).to.equal(200);

            expect(await response.json()).to.deep.equal({
                currency: 'GBP',
                unit_price: 69 / 5,
                current_quantity: 5,
                renewal_quantity: 5,
                min_quantity: 4,
                max_quantity: MAX_TEAM_SIZE,
                interval: 'monthly',
                next_bill_date: billDate,
                days_in_period: moment.utc(billDate).diff(
                    moment.utc(billDate).subtract(1, 'month'), 'days'
                ),
                days_remaining: moment.utc(billDate).diff(moment.utc().startOf('day'), 'days')
            });
        });

        it("refuses to guess a price when the subscription reports none", async () => {
            const { ownerAuthToken } = await givenFourMemberTeam(1);
            // No next payment data, and past transactions can't fill the gap - Paddle
            // doesn't record what quantity any of them covered:
            await givenPaddleSubscription(2, { quantity: 5 });

            const response = await getTeamSizeQuote(apiServer, ownerAuthToken);
            expect(response.status).to.equal(502);
        });

        it("reports a reduction that's pending until renewal", async () => {
            const { ownerAuthToken } = await givenFourMemberTeam(3); // 7 licenses paid for
            await givenPaddleSubscription(2, {
                quantity: 5, // Reduced, effective at renewal
                next_payment: { amount: 50, currency: 'EUR', date: nextBillDate() }
            });

            const response = await getTeamSizeQuote(apiServer, ownerAuthToken);
            expect(response.status).to.equal(200);

            const quote = await response.json();
            expect(quote.current_quantity).to.equal(7);
            expect(quote.renewal_quantity).to.equal(5);
            expect(quote.unit_price).to.equal(50 / 5);
        });

        it("refuses to quote while an upgrade is still arriving from Paddle", async () => {
            const { ownerAuthToken } = await givenFourMemberTeam(1); // 5 licenses stored
            await givenPaddleSubscription(2, {
                quantity: 7, // A change that hasn't reached us by webhook yet
                next_payment: { amount: 70, currency: 'EUR', date: nextBillDate() }
            });

            const response = await getTeamSizeQuote(apiServer, ownerAuthToken);
            expect(response.status).to.equal(409);
        });

        it("refuses to quote subscriptions with a coupon, which Paddle would drop", async () => {
            const { ownerAuthToken, updateOwnerData } = await givenFourMemberTeam(1);
            await updateOwnerData({ subscription_coupon: 'DISCOUNT10' });
            await givenPaddleSubscription(2, {
                quantity: 5,
                next_payment: { amount: 50, currency: 'EUR', date: nextBillDate() }
            });

            const response = await getTeamSizeQuote(apiServer, ownerAuthToken);
            expect(response.status).to.equal(400);
        });

        it("does not count locked licenses towards the minimum team size", async () => {
            const { ownerAuthToken, updateOwnerData } = await givenFourMemberTeam(2); // 6 licenses
            await updateOwnerData({ locked_licenses: [Date.now()] });

            await givenPaddleSubscription(2, {
                quantity: 6,
                next_payment: { amount: 72, currency: 'EUR', date: nextBillDate() }
            });

            const response = await getTeamSizeQuote(apiServer, ownerAuthToken);
            expect(response.status).to.equal(200);

            const quote = await response.json();
            expect(quote.current_quantity).to.equal(6);
            expect(quote.min_quantity).to.equal(4); // 4 assigned; the lock is irrelevant
        });

    });

});
