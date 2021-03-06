import * as net from 'net';
import fetch from 'node-fetch';
import * as jwt from 'jsonwebtoken';
import stoppable from 'stoppable';

import { expect } from 'chai';

import {
    startServer,
    publicKey,
    auth0Server,
    AUTH0_PORT,
    freshAuthToken
} from './test-util';
import { TeamOwnerMetadata } from '../src/auth0';

const getAppData = (server: net.Server, authToken?: string) => fetch(
    `http://localhost:${(server.address() as net.AddressInfo).port}/get-app-data`,
    {
        headers: authToken
            ? { Authorization: `Bearer ${authToken}` }
            : undefined
    }
);

const getJwtData = (jwtString: string): any => {
    const decoded: any = jwt.verify(jwtString, publicKey, {
        algorithms: ['RS256'],
        audience: 'https://httptoolkit.tech/app_data',
        issuer: 'https://httptoolkit.tech/'
    });

    // Remove the JWT metadata properties, for easier validation later
    delete decoded.aud;
    delete decoded.exp;
    delete decoded.iat;
    delete decoded.iss;

    return decoded;
}

describe('/get-app-data', () => {

    let functionServer: stoppable.StoppableServer;

    beforeEach(async () => {
        functionServer = await startServer();
        await auth0Server.start(AUTH0_PORT);
        await auth0Server.post('/oauth/token').thenReply(200);
    });

    afterEach(async () => {
        await new Promise((resolve) => functionServer.stop(resolve));
        await auth0Server.stop();
    });

    describe("for unauthed users", () => {
        it("returns 401", async () => {
            const response = await getAppData(functionServer);
            expect(response.status).to.equal(401);
        });
    });

    describe("for free users", () => {
        it("returns signed but empty data", async () => {
            const authToken = freshAuthToken();
            const userId = "abc";
            const userEmail = 'user@example.com';

            await auth0Server.get('/userinfo')
                .withHeaders({ 'Authorization': 'Bearer ' + authToken })
                .thenJson(200, { sub: userId });
            await auth0Server.get('/api/v2/users/' + userId).thenJson(200, {
                email: userEmail,
                app_metadata: { }
            });

            const response = await getAppData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({ email: userEmail });
        });
    });

    describe("for Pro users", () => {
        it("returns signed subscription data", async () => {
            const authToken = freshAuthToken();
            const userId = "abc";
            const userEmail = 'user@example.com';
            const subExpiry = Date.now();

            await auth0Server.get('/userinfo')
                .withHeaders({ 'Authorization': 'Bearer ' + authToken })
                .thenJson(200, { sub: userId });
            await auth0Server.get('/api/v2/users/' + userId)
                .thenJson(200, {
                    email: userEmail,
                    app_metadata: {
                        subscription_expiry: subExpiry,
                        subscription_id: 2,
                        subscription_plan_id: 550380,
                        subscription_status: "active"
                    }
                });

            const response = await getAppData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: userEmail,
                subscription_expiry: subExpiry,
                subscription_id: 2,
                subscription_plan_id: 550380,
                subscription_status: "active"
            });
        });

        it("caches userinfo lookups", async () => {
            const authToken = freshAuthToken();
            const userId = "abc";
            const userEmail = 'user@example.com';
            const subExpiry = Date.now();

            const userInfoLookup = await auth0Server.get('/userinfo')
                .withHeaders({ 'Authorization': 'Bearer ' + authToken })
                .thenJson(200, { sub: userId });

            const userDataLookup = await auth0Server.get('/api/v2/users/' + userId)
                .thenJson(200, {
                    email: userEmail,
                    app_metadata: {
                        subscription_expiry: subExpiry,
                        subscription_id: 2,
                        subscription_plan_id: 550380,
                        subscription_status: "active"
                    }
                });

            const response1 = await getAppData(functionServer, authToken);
            expect(response1.status).to.equal(200);
            expect(getJwtData((await response1.text())).subscription_status).to.equal('active');

            const response2 = await getAppData(functionServer, authToken);
            expect(response1.status).to.equal(200);
            expect(getJwtData((await response2.text())).subscription_status).to.equal('active');

            const [userInfoRequests, userDataRequests] = await Promise.all([
                userInfoLookup.getSeenRequests(),
                userDataLookup.getSeenRequests()
            ]);

            expect(userInfoRequests.length).to.equal(1);
            expect(userDataRequests.length).to.equal(2);
        });
    });

    describe("for Team users", () => {
        it("returns signed subscription data for team members", async () => {
            const authToken = freshAuthToken();
            const billingUserId = "abc";
            const billingUserEmail = 'billinguser@example.com';
            const teamUserId = "def";
            const teamUserEmail = 'teamuser@example.com';
            const subExpiry = Date.now();

            await auth0Server.get('/userinfo')
                .withHeaders({ 'Authorization': 'Bearer ' + authToken })
                .thenJson(200, { sub: teamUserId });
            await auth0Server.get('/api/v2/users/' + teamUserId).thenJson(200, {
                email: teamUserEmail,
                app_metadata: { subscription_owner_id: billingUserId }
            });
            await auth0Server.get('/api/v2/users/' + billingUserId).thenJson(200, {
                email: billingUserEmail,
                app_metadata: {
                    team_member_ids: ['123', '456', teamUserId],
                    subscription_expiry: subExpiry,
                    subscription_id: 2,
                    subscription_quantity: 3,
                    subscription_plan_id: 550789,
                    subscription_status: "active",
                    last_receipt_url: 'lru',
                    cancel_url: 'cu',
                    update_url: 'uu',
                }
            });

            const response = await getAppData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: teamUserEmail,
                subscription_owner_id: billingUserId,
                subscription_expiry: subExpiry,
                subscription_id: 2,
                subscription_plan_id: 550789,
                subscription_status: "active"
            });
        });

        it("returns separated team subscription data for team owners", async () => {
            const authToken = freshAuthToken();
            const billingUserId = "abc";
            const billingUserEmail = 'billinguser@example.com';
            const subExpiry = Date.now();

            await auth0Server.get('/userinfo')
                .withHeaders({ 'Authorization': 'Bearer ' + authToken })
                .thenJson(200, { sub: billingUserId });
            await auth0Server.get('/api/v2/users/' + billingUserId).thenJson(200, {
                email: billingUserEmail,
                app_metadata: {
                    feature_flags: ['a flag'],
                    team_member_ids: ['123', '456'],
                    subscription_expiry: subExpiry,
                    subscription_id: 2,
                    subscription_quantity: 2,
                    subscription_plan_id: 550789,
                    subscription_status: "active",
                    last_receipt_url: 'lru',
                    cancel_url: 'cu',
                    update_url: 'uu',
                }
            });

            const response = await getAppData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: billingUserEmail,
                feature_flags: ['a flag'],
                team_subscription: {
                    team_member_ids: ['123', '456'],
                    subscription_expiry: subExpiry,
                    subscription_id: 2,
                    subscription_quantity: 2,
                    subscription_plan_id: 550789,
                    subscription_status: "active",
                    last_receipt_url: 'lru',
                    cancel_url: 'cu',
                    update_url: 'uu'
                }
            });
        });

        it("returns real+separated subscription data for owners who are in their team", async () => {
            const authToken = freshAuthToken();
            const billingUserId = "abc";
            const billingUserEmail = 'billinguser@example.com';
            const subExpiry = Date.now();

            await auth0Server.get('/userinfo')
                .withHeaders({ 'Authorization': 'Bearer ' + authToken })
                .thenJson(200, { sub: billingUserId });
            await auth0Server.get('/api/v2/users/' + billingUserId).thenJson(200, {
                email: billingUserEmail,
                app_metadata: {
                    subscription_owner_id: billingUserId, // Points to their own id
                    feature_flags: ['a flag'],
                    team_member_ids: [billingUserId], // Includes their own id
                    subscription_expiry: subExpiry,
                    subscription_id: 2,
                    subscription_quantity: 2,
                    subscription_plan_id: 550789,
                    subscription_status: "active",
                    last_receipt_url: 'lru',
                    cancel_url: 'cu',
                    update_url: 'uu',
                }
            });

            const response = await getAppData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: billingUserEmail,
                subscription_owner_id: billingUserId,
                feature_flags: ['a flag'],

                subscription_expiry: subExpiry,
                subscription_id: 2,
                subscription_plan_id: 550789,
                subscription_status: "active",

                team_subscription: {
                    team_member_ids: [billingUserId],
                    subscription_expiry: subExpiry,
                    subscription_id: 2,
                    subscription_quantity: 2,
                    subscription_plan_id: 550789,
                    subscription_status: "active",
                    last_receipt_url: 'lru',
                    cancel_url: 'cu',
                    update_url: 'uu'
                }
            });
        });

        it("returns empty data for team members beyond the subscribed quantity", async () => {
            const authToken = freshAuthToken();
            const billingUserId = "abc";
            const billingUserEmail = 'billinguser@example.com';
            const teamUserId = "def";
            const teamUserEmail = 'teamuser@example.com';
            const subExpiry = Date.now();

            await auth0Server.get('/userinfo')
                .withHeaders({ 'Authorization': 'Bearer ' + authToken })
                .thenJson(200, { sub: teamUserId });
            await auth0Server.get('/api/v2/users/' + teamUserId).thenJson(200, {
                email: teamUserEmail,
                app_metadata: { subscription_owner_id: billingUserId }
            });
            await auth0Server.get('/api/v2/users/' + billingUserId).thenJson(200, {
                email: billingUserEmail,
                app_metadata: {
                    team_member_ids: ['123', '456', teamUserId],
                    subscription_quantity: 2, // <-- 2 allowed, but we're 3rd in the ids above
                    subscription_expiry: subExpiry,
                    subscription_id: 2,
                    subscription_plan_id: 550789,
                    subscription_status: "active",
                    last_receipt_url: 'lru',
                    cancel_url: 'cu',
                    update_url: 'uu',
                }
            });

            const response = await getAppData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: teamUserEmail
            });
        });

        it("returns empty data for team members beyond the subscribed quantity due to locked licenses", async () => {
            const authToken = freshAuthToken();
            const billingUserId = "abc";
            const billingUserEmail = 'billinguser@example.com';
            const teamUserId = "def";
            const teamUserEmail = 'teamuser@example.com';
            const subExpiry = Date.now();

            await auth0Server.get('/userinfo')
                .withHeaders({ 'Authorization': 'Bearer ' + authToken })
                .thenJson(200, { sub: teamUserId });
            await auth0Server.get('/api/v2/users/' + teamUserId).thenJson(200, {
                email: teamUserEmail,
                app_metadata: { subscription_owner_id: billingUserId }
            });
            await auth0Server.get('/api/v2/users/' + billingUserId).thenJson(200, {
                email: billingUserEmail,
                app_metadata: {
                    team_member_ids: ['123', '456', teamUserId],
                    locked_licenses: [new Date(2050, 0, 0).getTime()], // Locked for ~30 years
                    subscription_quantity: 3, // <-- 3 allowed, OK except for the locked license
                    subscription_expiry: subExpiry,
                    subscription_id: 2,
                    subscription_plan_id: 550789,
                    subscription_status: "active",
                    last_receipt_url: 'lru',
                    cancel_url: 'cu',
                    update_url: 'uu',
                } as TeamOwnerMetadata
            });

            const response = await getAppData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: teamUserEmail
            });
        });

        it("returns empty data for team members with inconsistent membership data", async () => {
            const authToken = freshAuthToken();
            const billingUserId = "abc";
            const billingUserEmail = 'billinguser@example.com';
            const teamUserId = "def";
            const teamUserEmail = 'teamuser@example.com';
            const subExpiry = Date.now();

            await auth0Server.get('/userinfo')
                .withHeaders({ 'Authorization': 'Bearer ' + authToken })
                .thenJson(200, { sub: teamUserId });
            await auth0Server.get('/api/v2/users/' + teamUserId).thenJson(200, {
                email: teamUserEmail,
                app_metadata: { subscription_owner_id: billingUserId }
            });
            await auth0Server.get('/api/v2/users/' + billingUserId).thenJson(200, {
                email: billingUserEmail,
                app_metadata: {
                    team_member_ids: [], // <-- doesn't include this user
                    subscription_expiry: subExpiry,
                    subscription_id: 2,
                    subscription_plan_id: 550789,
                    subscription_status: "active",
                    last_receipt_url: 'lru',
                    cancel_url: 'cu',
                    update_url: 'uu',
                }
            });

            const response = await getAppData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: teamUserEmail
            });
        });
    });
});