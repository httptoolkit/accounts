import _ from 'lodash';
import * as net from 'net';
import { DestroyableServer } from 'destroyable-server';

import { expect } from 'chai';

import {
    startAPI,
    freshAuthToken,
    givenTeam,
    delay,
    givenAuthToken,
    givenUser
} from './test-setup/setup.ts';
import {
    paddleServer,
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
                subscription_expiry: subExpiry,
                subscription_id: '2',
                subscription_plan_id: 550380,
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

            const { updateOwnerData, ownerAuthToken } = await givenTeam(team);

            const paddleUpdateEndpoint = await paddleServer.forPost('/api/2.0/subscription/users/update')
                .thenJson(200, { success: true });

            const newQuantity = 10;
            const teamUpdatePromise = updateTeamSize(apiServer, ownerAuthToken, newQuantity);

            // Wait until the backend sends an update to Paddle:
            while (true) {
                await delay(1);
                const paddleUpdates = await paddleUpdateEndpoint.getSeenRequests();
                if (paddleUpdates.length >= 1) break;
            }

            // Simulate the user being updated by an async webhook:
            updateOwnerData({ subscription_quantity: newQuantity });

            const response = await teamUpdatePromise;
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

            const { updateOwnerData, ownerAuthToken } = await givenTeam(team);

            const paddleUpdateEndpoint = await paddleServer.forPost('/api/2.0/subscription/users/update')
                .thenJson(200, { success: true });

            const newQuantity = 4;
            const teamUpdatePromise = updateTeamSize(apiServer, ownerAuthToken, newQuantity);

            // Wait until the backend sends an update to Paddle:
            while (true) {
                await delay(1);
                const paddleUpdates = await paddleUpdateEndpoint.getSeenRequests();
                if (paddleUpdates.length >= 1) break;
            }

            // Simulate the user being updated by an async webhook:
            updateOwnerData({ subscription_quantity: newQuantity });

            const response = await teamUpdatePromise;
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

        it("refuses to decrease the team size below the currently assigned licenses", async () => {
            const team: Array<
                | { id: string, email: string}
                | undefined
            > = _.range(4).map((i) => ({
                id: i.toString(),
                email: `member${i}@example.com`
            }));
            team.push(undefined);

            const { ownerAuthToken } = await givenTeam(team);

            const paddleUpdateEndpoint = await paddleServer.forPost('/api/2.0/subscription/users/update')
                .thenJson(200, { success: true });

            const newQuantity = 3;
            const response = await updateTeamSize(apiServer, ownerAuthToken, newQuantity);
            expect(response.status).to.equal(409);

            expect((await paddleUpdateEndpoint.getSeenRequests()).length).to.equal(0);
        });
    });
});