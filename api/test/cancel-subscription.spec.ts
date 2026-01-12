import _ from 'lodash';
import * as net from 'net';
import { DestroyableServer } from 'destroyable-server';

import { expect } from 'chai';

import {
    startAPI,
    givenUser,
    freshAuthToken,
    givenAuthToken
} from './test-setup/setup.ts';
import { PADDLE_PORT, paddleServer } from './test-setup/paddle.ts';
import { PAYPRO_API_PORT, payproApiServer } from './test-setup/paypro.ts';

const cancelSubscription = (server: net.Server, authToken?: string) => fetch(
    `http://localhost:${(server.address() as net.AddressInfo).port}/api/cancel-subscription`,
    {
        method: 'POST',
        headers: authToken
            ? { Authorization: `Bearer ${authToken}` }
            : undefined
    }
);

describe('Subscription cancellation API', () => {

    let apiServer: DestroyableServer;

    beforeEach(async () => {
        apiServer = await startAPI();
        await paddleServer.start(PADDLE_PORT);
        await payproApiServer.start(PAYPRO_API_PORT);
    });

    afterEach(async () => {
        await apiServer.destroy();
        await paddleServer.stop();
        await payproApiServer.stop();
    });

    it("should return a 401 for unauthenticated requests", async () => {
        const response = await cancelSubscription(apiServer);
        expect(response.status).to.equal(401);
    });

    it("should successfully cancel active Paddle subscriptions", async () => {
        const authToken = freshAuthToken();
        const userId = "abc";
        const userEmail = 'user@example.com';

        await givenUser(userId, userEmail, {
            payment_provider: 'paddle',
            subscription_id: '2',
            subscription_status: "active"
        });
        await givenAuthToken(authToken, userId);

        const cancelEndpoint = await paddleServer.forPost('/api/2.0/subscription/users_cancel')
            .thenJson(200, { success: true });

        const response = await cancelSubscription(apiServer, authToken);
        expect(response.status).to.equal(200);

        const paddleRequests = await cancelEndpoint.getSeenRequests();
        expect(paddleRequests.length).to.equal(1);
        const cancelRequest = paddleRequests[0];
        expect((await cancelRequest.body.getFormData())!.subscription_id).to.equal('2');
    });

    it("should successfully cancel active PayPro subscriptions", async () => {
        const authToken = freshAuthToken();
        const userId = "abc";
        const userEmail = 'user@example.com';

        await givenUser(userId, userEmail, {
            payment_provider: 'paypro',
            subscription_id: '2',
            subscription_status: "active"
        });
        await givenAuthToken(authToken, userId);

        const cancelEndpoint = await payproApiServer.forPost('/api/Subscriptions/Terminate')
            .thenJson(200, { isSuccess: true });

        const response = await cancelSubscription(apiServer, authToken);
        expect(response.status).to.equal(200);

        const paddleRequests = await cancelEndpoint.getSeenRequests();
        expect(paddleRequests.length).to.equal(1);
        const cancelRequest = paddleRequests[0];
        expect((await cancelRequest.body.getJson() as any).subscriptionId).to.equal('2');
    });

    it("should refuse to cancel subscriptions for users who don't have one", async () => {
        const authToken = freshAuthToken();
        const userId = "abc";
        const userEmail = 'user@example.com';

        await givenUser(userId, userEmail, {});
        await givenAuthToken(authToken, userId);

        const cancelEndpoint = await paddleServer.forPost('/api/2.0/subscription/users_cancel')
            .thenJson(200, { success: true });

        const response = await cancelSubscription(apiServer, authToken);
        expect(response.status).to.equal(400);

        const paddleRequests = await cancelEndpoint.getSeenRequests();
        expect(paddleRequests.length).to.equal(0);
    });

    it("should successfully cancel subscriptions for team owners", async () => {
        const authToken = freshAuthToken();
        const billingUserId = "abc";
        const billingUserEmail = 'billinguser@example.com';
        const teamUserId = "def";

        await givenUser(billingUserId, billingUserEmail, {
            payment_provider: 'paddle',
            team_member_ids: ['123', '456', teamUserId],
            subscription_id: '2',
            subscription_status: "active"
        });
        await givenAuthToken(authToken, billingUserId);

        const cancelEndpoint = await paddleServer.forPost('/api/2.0/subscription/users_cancel')
            .thenJson(200, { success: true });

        const response = await cancelSubscription(apiServer, authToken);
        expect(response.status).to.equal(200);

        const paddleRequests = await cancelEndpoint.getSeenRequests();
        expect(paddleRequests.length).to.equal(1);
        const cancelRequest = paddleRequests[0];
        expect((await cancelRequest.body.getFormData())!.subscription_id).to.equal('2');
    });

    it("should refuse to cancel subscriptions for team members", async () => {
        const authToken = freshAuthToken();
        const billingUserId = "abc";
        const billingUserEmail = 'billinguser@example.com';
        const teamUserId = "def";
        const teamUserEmail = 'teamuser@example.com';

        await givenUser(teamUserId, teamUserEmail, {
            subscription_owner_id: billingUserId
        });
        await givenAuthToken(authToken, teamUserId);

        await givenUser(billingUserId, billingUserEmail, {
            payment_provider: 'paddle',
            team_member_ids: ['123', '456', teamUserId],
            subscription_id: '2',
            subscription_status: "active"
        });

        const cancelEndpoint = await paddleServer.forPost('/api/2.0/subscription/users_cancel')
            .thenJson(200, { success: true });

        const response = await cancelSubscription(apiServer, authToken);
        expect(response.status).to.equal(400);

        const paddleRequests = await cancelEndpoint.getSeenRequests();
        expect(paddleRequests.length).to.equal(0);
    });

    it("should refuse to cancel already cancelled subscriptions", async () => {
        const authToken = freshAuthToken();
        const userId = "abc";
        const userEmail = 'user@example.com';

        await givenUser(userId, userEmail, {
            payment_provider: 'paddle',
            subscription_id: '2',
            subscription_status: "deleted"
        });
        await givenAuthToken(authToken, userId);

        const cancelEndpoint = await paddleServer.forPost('/api/2.0/subscription/users_cancel')
            .thenJson(200, { success: true });

        const response = await cancelSubscription(apiServer, authToken);
        expect(response.status).to.equal(400);

        const paddleRequests = await cancelEndpoint.getSeenRequests();
        expect(paddleRequests.length).to.equal(0);
    });

});