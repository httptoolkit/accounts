import _ from 'lodash';
import * as net from 'net';
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

const updateTeamSize = (server: net.Server, authToken: string | undefined, newTeamSize: number) => fetch(
    `http://localhost:${(server.address() as net.AddressInfo).port}/api/update-team-size`,
    {
        method: 'POST',
        headers: {
            ...(authToken
                ? { Authorization: `Bearer ${authToken}` }
                : {}
            ),
            'content-type': 'application/json'
        },
        body: JSON.stringify({ newTeamSize })
    }
);

type TeamSlots = Array<{ id: string, email: string, joinedAt?: number } | undefined>;

// A team, plus its Paddle subscription. Paddle's quantity is what the next renewal
// bills, so a lower one there means a reduction is pending:
const givenPaddleTeam = async (team: TeamSlots, renewalQuantity = team.length) => {
    const result = await givenTeam(team);
    await givenPaddleSubscription(2, { quantity: renewalQuantity });
    return result;
};

const givenMembersAndSpaces = (members: number, licenses: number): TeamSlots => [
    ..._.range(members).map((i) => ({ id: i.toString(), email: `member${i}@example.com` })),
    ..._.range(licenses - members).map(() => undefined)
];

const paddleUpdate = (quantity: number, upgrade: boolean) => ({
    vendor_id: "undefined",
    vendor_auth_code: "undefined",
    subscription_id: "2",
    quantity: quantity.toString(),
    prorate: upgrade.toString(),
    bill_immediately: upgrade.toString()
});

describe('/update-team-size', () => {

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
            const response = await updateTeamSize(apiServer, undefined, 5);
            expect(response.status).to.equal(401);
        });
    });

    describe("for free users", () => {
        it("returns 403", async () => {
            const authToken = freshAuthToken();
            const userId = "abc";
            const userEmail = 'user@example.com';

            await givenUser(userId, userEmail);
            await givenAuthToken(authToken, userId);
            await auth0Server.forGet('/api/v2/users').thenJson(200, []);

            const response = await updateTeamSize(apiServer, authToken, 5);
            expect(response.status).to.equal(403);
        });
    });

    describe("for Pro users", () => {
        it("returns 403", async () => {
            const authToken = freshAuthToken();
            const userId = "abc";
            const userEmail = 'user@example.com';
            const subExpiry = Date.now();

            await givenUser(userId, userEmail, {
                payment_provider: 'paddle',
                subscription_expiry: subExpiry,
                subscription_id: '2',
                subscription_sku: 'pro-monthly',
                subscription_status: "active"
            });
            await givenAuthToken(authToken, userId);
            await auth0Server.forGet('/api/v2/users').thenJson(200, []);

            const response = await updateTeamSize(apiServer, authToken, 5);
            expect(response.status).to.equal(403);
        });
    });

    describe("for Team users", () => {
        it("allows increasing the team size", async () => {
            const team = _.range(4).map((i) => ({
                id: i.toString(),
                email: `member${i}@example.com`
            }));

            const { ownerAuthToken } = await givenPaddleTeam(team);

            const paddleUpdateEndpoint = await paddleServer.forPost('/api/2.0/subscription/users/update')
                .thenJson(200, { success: true });

            const newQuantity = 10;
            const response = await updateTeamSize(apiServer, ownerAuthToken, newQuantity);
            expect(response.status).to.equal(200);

            const paddleUpdates = await paddleUpdateEndpoint.getSeenRequests();
            expect(paddleUpdates.length).to.equal(1);

            const paddleUpdatesData = await Promise.all(paddleUpdates.map(r => r.body.getFormData()));
            expect(paddleUpdatesData).to.deep.equal([{
                vendor_id: "undefined",
                vendor_auth_code: "undefined",
                subscription_id: "2",

                quantity: newQuantity.toString(),

                prorate: "true",
                bill_immediately: "true"
            }]);
        });

        it("allows decreasing the team size", async () => {
            const team: Array<
                | { id: string, email: string}
                | undefined
            > = _.range(4).map((i) => ({
                id: i.toString(),
                email: `member${i}@example.com`
            }));
            team.push(undefined);

            const { ownerAuthToken } = await givenPaddleTeam(team);

            const paddleUpdateEndpoint = await paddleServer.forPost('/api/2.0/subscription/users/update')
                .thenJson(200, { success: true });

            const newQuantity = 4;
            const response = await updateTeamSize(apiServer, ownerAuthToken, newQuantity);
            expect(response.status).to.equal(200);

            const paddleUpdates = await paddleUpdateEndpoint.getSeenRequests();
            expect(paddleUpdates.length).to.equal(1);

            const paddleUpdatesData = await Promise.all(paddleUpdates.map(r => r.body.getFormData()));
            expect(paddleUpdatesData).to.deep.equal([{
                vendor_id: "undefined",
                vendor_auth_code: "undefined",
                subscription_id: "2",

                quantity: newQuantity.toString(),

                prorate: "false",
                bill_immediately: "false"
            }]);
        });

        it("defers a decrease that's still above the assigned license count", async () => {
            // Four members, but ten licenses paid for:
            const team: Array<
                | { id: string, email: string}
                | undefined
            > = _.range(4).map((i) => ({
                id: i.toString(),
                email: `member${i}@example.com`
            }));
            while (team.length < 10) team.push(undefined);

            const { ownerAuthToken } = await givenPaddleTeam(team);

            const paddleUpdateEndpoint = await paddleServer.forPost('/api/2.0/subscription/users/update')
                .thenJson(200, { success: true });

            // Above the 4 assigned licenses, but well below the 10 being paid for, so
            // this is a downgrade and must not bill anything immediately:
            const newQuantity = 6;
            const response = await updateTeamSize(apiServer, ownerAuthToken, newQuantity);
            expect(response.status).to.equal(200);

            const paddleUpdates = await paddleUpdateEndpoint.getSeenRequests();
            const paddleUpdatesData = await Promise.all(paddleUpdates.map(r => r.body.getFormData()));
            expect(paddleUpdatesData).to.deep.equal([{
                vendor_id: "undefined",
                vendor_auth_code: "undefined",
                subscription_id: "2",

                quantity: newQuantity.toString(),

                prorate: "false",
                bill_immediately: "false"
            }]);
        });

        it("allows decreasing below the number of locked licenses", async () => {
            const { ownerAuthToken, updateOwnerData } = await givenPaddleTeam([
                { id: '0', email: 'member0@example.com' },
                undefined
            ]);
            await updateOwnerData({ locked_licenses: [Date.now()] });

            const paddleUpdateEndpoint = await paddleServer.forPost('/api/2.0/subscription/users/update')
                .thenJson(200, { success: true });

            const response = await updateTeamSize(apiServer, ownerAuthToken, 1);
            expect(response.status).to.equal(200);

            const paddleUpdates = await paddleUpdateEndpoint.getSeenRequests();
            const paddleUpdatesData = await Promise.all(paddleUpdates.map(r => r.body.getFormData()));
            expect(paddleUpdatesData).to.deep.equal([{
                vendor_id: "undefined",
                vendor_auth_code: "undefined",
                subscription_id: "2",

                quantity: "1",

                prorate: "false",
                bill_immediately: "false"
            }]);
        });

        it("restores the paid quantity before an upgrade while a reduction is pending", async () => {
            // 10 licenses paid for this period, but Paddle is set to renew at 6:
            const { ownerAuthToken } = await givenPaddleTeam(givenMembersAndSpaces(4, 10), 6);

            const paddleUpdateEndpoint = await paddleServer.forPost('/api/2.0/subscription/users/update')
                .thenJson(200, { success: true });

            const response = await updateTeamSize(apiServer, ownerAuthToken, 12);
            expect(response.status).to.equal(200);

            const paddleUpdates = await paddleUpdateEndpoint.getSeenRequests();
            expect(await Promise.all(paddleUpdates.map(r => r.body.getFormData()))).to.deep.equal([
                paddleUpdate(10, false), // Restore, uncharged
                paddleUpdate(12, true) // Only the 2 new licenses are pro-rated
            ]);
        });

        it("cancels a pending reduction without charging", async () => {
            const { ownerAuthToken } = await givenPaddleTeam(givenMembersAndSpaces(4, 10), 6);

            const paddleUpdateEndpoint = await paddleServer.forPost('/api/2.0/subscription/users/update')
                .thenJson(200, { success: true });

            const response = await updateTeamSize(apiServer, ownerAuthToken, 10);
            expect(response.status).to.equal(200);

            const paddleUpdates = await paddleUpdateEndpoint.getSeenRequests();
            expect(await Promise.all(paddleUpdates.map(r => r.body.getFormData()))).to.deep.equal([
                paddleUpdate(10, false)
            ]);
        });

        it("refuses a size that's already scheduled for renewal", async () => {
            const { ownerAuthToken } = await givenPaddleTeam(givenMembersAndSpaces(4, 10), 6);

            const paddleUpdateEndpoint = await paddleServer.forPost('/api/2.0/subscription/users/update')
                .thenJson(200, { success: true });

            const response = await updateTeamSize(apiServer, ownerAuthToken, 6);
            expect(response.status).to.equal(400);
            expect((await paddleUpdateEndpoint.getSeenRequests()).length).to.equal(0);
        });

        it("refuses changes while an upgrade is still arriving from Paddle", async () => {
            const { ownerAuthToken } = await givenPaddleTeam(givenMembersAndSpaces(4, 5), 7);

            const paddleUpdateEndpoint = await paddleServer.forPost('/api/2.0/subscription/users/update')
                .thenJson(200, { success: true });

            const response = await updateTeamSize(apiServer, ownerAuthToken, 9);
            expect(response.status).to.equal(409);
            expect((await paddleUpdateEndpoint.getSeenRequests()).length).to.equal(0);
        });

        it("refuses non-integer and oversized quantities", async () => {
            const team = _.range(4).map((i) => ({
                id: i.toString(),
                email: `member${i}@example.com`
            }));

            const { ownerAuthToken } = await givenPaddleTeam(team);

            const paddleUpdateEndpoint = await paddleServer.forPost('/api/2.0/subscription/users/update')
                .thenJson(200, { success: true });

            for (const invalidSize of [4.5, 100_000]) {
                const response = await updateTeamSize(apiServer, ownerAuthToken, invalidSize);
                expect(response.status).to.equal(400);
            }

            expect((await paddleUpdateEndpoint.getSeenRequests()).length).to.equal(0);
        });

        it("refuses to decrease the team size below the currently assigned licenses", async () => {
            const team: Array<
                | { id: string, email: string}
                | undefined
            > = _.range(4).map((i) => ({
                id: i.toString(),
                email: `member${i}@example.com`
            }));
            team.push(undefined);

            const { ownerAuthToken } = await givenPaddleTeam(team);

            const paddleUpdateEndpoint = await paddleServer.forPost('/api/2.0/subscription/users/update')
                .thenJson(200, { success: true });

            const newQuantity = 3;
            const response = await updateTeamSize(apiServer, ownerAuthToken, newQuantity);
            expect(response.status).to.equal(409);

            expect((await paddleUpdateEndpoint.getSeenRequests()).length).to.equal(0);
        });
    });
});