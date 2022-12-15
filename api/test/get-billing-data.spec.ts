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
    freshAuthToken,
    paddleServer,
    PADDLE_PORT,
    givenSubscription,
    givenTransactions,
    id
} from './test-util';
import { TransactionData } from '../../module/src/types';
import { LICENSE_LOCK_DURATION_MS, TeamOwnerMetadata } from '../src/auth0';

const getBillingData = (server: net.Server, authToken?: string) => fetch(
    `http://localhost:${(server.address() as net.AddressInfo).port}/get-billing-data`,
    {
        headers: authToken
            ? { Authorization: `Bearer ${authToken}` }
            : undefined
    }
);

const getJwtData = (jwtString: string): any => {
    const decoded: any = jwt.verify(jwtString, publicKey, {
        algorithms: ['RS256'],
        audience: 'https://httptoolkit.tech/billing_data',
        issuer: 'https://httptoolkit.tech/'
    });

    // Remove the JWT metadata properties, for easier validation later
    delete decoded.aud;
    delete decoded.exp;
    delete decoded.iat;
    delete decoded.iss;

    return decoded;
}

describe('/get-billing-data', () => {

    let functionServer: stoppable.StoppableServer;

    beforeEach(async () => {
        functionServer = await startServer();

        await auth0Server.start(AUTH0_PORT);
        await auth0Server.post('/oauth/token').thenReply(200);

        await paddleServer.start(PADDLE_PORT);
    });

    afterEach(async () => {
        await new Promise((resolve) => functionServer.stop(resolve));
        await auth0Server.stop();
        await paddleServer.stop();
    });

    describe("for unauthed users", () => {
        it("returns 401", async () => {
            const response = await getBillingData(functionServer);
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

            const response = await getBillingData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: userEmail,
                transactions: []
            });
        });
    });

    describe("for Pro users", () => {
        it("returns signed subscription data", async () => {
            const authToken = freshAuthToken();
            const userId = "abc";
            const userEmail = 'user@example.com';

            const subId = id();
            const subExpiry = Date.now();

            await auth0Server.get('/userinfo')
                .withHeaders({ 'Authorization': 'Bearer ' + authToken })
                .thenJson(200, { sub: userId });
            await auth0Server.get('/api/v2/users/' + userId)
                .thenJson(200, {
                    email: userEmail,
                    app_metadata: {
                        subscription_expiry: subExpiry,
                        subscription_id: subId,
                        subscription_sku: 'pro-monthly',
                        subscription_plan_id: 550380,
                        subscription_status: "active"
                    }
                });

            const { paddleUserId } = await givenSubscription(subId);
            const transaction: TransactionData = {
                amount: "1.00",
                currency: "USD",
                created_at: new Date().toISOString(),
                order_id: "order-456",
                product_id: 550380,
                receipt_url: "receipt.example",
                status: "completed"
            };
            await givenTransactions(paddleUserId, [transaction]);

            const response = await getBillingData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: userEmail,
                subscription_expiry: subExpiry,
                subscription_id: subId,
                subscription_sku: 'pro-monthly',
                subscription_plan_id: 550380,
                subscription_status: "active",
                transactions: [transaction]
            });
        });

        it("caches userinfo lookups", async () => {
            const authToken = freshAuthToken();
            const userId = "abc";
            const userEmail = 'user@example.com';

            const subId = id();
            const subExpiry = Date.now();

            const userInfoLookup = await auth0Server.get('/userinfo')
                .withHeaders({ 'Authorization': 'Bearer ' + authToken })
                .thenJson(200, { sub: userId });

            const userDataLookup = await auth0Server.get('/api/v2/users/' + userId)
                .thenJson(200, {
                    email: userEmail,
                    app_metadata: {
                        subscription_expiry: subExpiry,
                        subscription_id: subId,
                        subscription_sku: 'pro-monthly',
                        subscription_plan_id: 550380,
                        subscription_status: "active"
                    }
                });

            const { paddleUserId } = await givenSubscription(subId);
            await givenTransactions(paddleUserId, []);

            const response1 = await getBillingData(functionServer, authToken);
            expect(response1.status).to.equal(200);
            expect(getJwtData((await response1.text())).subscription_status).to.equal('active');

            const response2 = await getBillingData(functionServer, authToken);
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
        it("returns signed team membership data for team members", async () => {
            const authToken = freshAuthToken();
            const billingUserId = "abc";
            const billingUserEmail = 'billinguser@example.com';
            const teamUserId = "def";
            const teamUserEmail = 'teamuser@example.com';

            const subId = id();
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
                    subscription_id: subId,
                    subscription_quantity: 3,
                    subscription_sku: 'pro-monthly',
                    subscription_plan_id: 550789,
                    subscription_status: "active",
                    last_receipt_url: 'lru',
                    cancel_url: 'cu',
                    update_url: 'uu',
                }
            });

            const response = await getBillingData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: teamUserEmail,
                team_owner: {
                    id: billingUserId,
                    name: billingUserEmail
                },
                transactions: []
            });
        });

        it("returns signed subscription & member data for team owners", async () => {
            const authToken = freshAuthToken();
            const billingUserId = "abc";
            const billingUserEmail = 'billinguser@example.com';
            const team = [
                { id: '1', email: "teammember1@example.com" },
                { id: '2', email: "teammember2@example.com" },
                { id: '3', email: "teammember3@example.com" },
                { id: '4', email: "teammember4@example.com" },
            ];
            const subId = id();
            const subExpiry = Date.now();

            await auth0Server.get('/userinfo')
                .withHeaders({ 'Authorization': 'Bearer ' + authToken })
                .thenJson(200, { sub: billingUserId });
            await auth0Server.get('/api/v2/users/' + billingUserId).thenJson(200, {
                email: billingUserEmail,
                app_metadata: {
                    feature_flags: ['a flag'],
                    team_member_ids: ['1', '2', '3'],
                    locked_licenses: [
                        new Date(2000, 0, 0).getTime(), // Expired lock
                        new Date(2050, 0, 0).getTime() // Locked for ~30 years
                    ],
                    subscription_expiry: subExpiry,
                    subscription_id: subId,
                    subscription_quantity: 2, // <-- 2 allowed, but only 1 really due to locked license
                    subscription_sku: 'team-monthly',
                    subscription_plan_id: 550789,
                    subscription_status: "active",
                    last_receipt_url: 'lru',
                    cancel_url: 'cu',
                    update_url: 'uu',
                } as TeamOwnerMetadata
            });
            await auth0Server.get('/api/v2/users')
                .withQuery({ q: `app_metadata.subscription_owner_id:${billingUserId}` })
                .thenJson(200, [ // N.b: out of order - API order should match team_member_ids
                    {
                        user_id: team[1].id,
                        email: team[1].email,
                        app_metadata: { subscription_owner_id: billingUserId }
                    },
                    {
                        user_id: team[0].id,
                        email: team[0].email,
                        app_metadata: { subscription_owner_id: billingUserId }
                    },
                    {
                        user_id: team[2].id,
                        email: team[2].email,
                        app_metadata: { subscription_owner_id: billingUserId }
                    },
                    {
                        user_id: team[3].id,
                        email: team[3].email,
                        app_metadata: { }
                    }
                ]);

            const { paddleUserId } = await givenSubscription(subId);
            const transaction: TransactionData = {
                amount: "1.00",
                currency: "USD",
                created_at: new Date().toISOString(),
                order_id: "order-456",
                product_id: 550789,
                receipt_url: "receipt.example",
                status: "completed"
            };
            await givenTransactions(paddleUserId, [transaction]);

            const response = await getBillingData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: billingUserEmail,

                subscription_expiry: subExpiry,
                subscription_id: subId,
                locked_license_expiries: [
                    // Locked for ~30 years
                    new Date(2050, 0, 0).getTime() + LICENSE_LOCK_DURATION_MS
                ],
                subscription_quantity: 2, // <-- 2 allowed, but only 1 really due to locked license
                subscription_sku: 'team-monthly',
                subscription_plan_id: 550789,
                subscription_status: "active",
                last_receipt_url: 'lru',
                cancel_url: 'cu',
                update_url: 'uu',

                transactions: [transaction],
                team_members: [
                    { id: '1', name: team[0].email, locked: false },
                    // Rejected due to lock:
                    { id: '2', name: team[1].email, locked: false, error: 'member-beyond-team-limit' },
                    // Rejected due to quantity:
                    { id: '3', name: team[2].email, locked: false, error: 'member-beyond-team-limit' },
                    // Doesn't have subscription_owner_id:
                    { id: '4', name: team[3].email, locked: false, error: 'inconsistent-member-data' }
                ]
            });
        });

        it("returns subscription + member data for owners in their own team", async () => {
            const authToken = freshAuthToken();
            const billingUserId = "abc";
            const billingUserEmail = 'billinguser@example.com';

            const subId = id();
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
                    subscription_id: subId,
                    subscription_quantity: 1,
                    subscription_sku: 'team-monthly',
                    subscription_plan_id: 550789,
                    subscription_status: "active",
                    last_receipt_url: 'lru',
                    cancel_url: 'cu',
                    update_url: 'uu',
                }
            });
            await auth0Server.get('/api/v2/users')
                .withQuery({ q: `app_metadata.subscription_owner_id:${billingUserId}` })
                .thenJson(200, [
                    {
                        user_id: billingUserId,
                        email: billingUserEmail,
                        app_metadata: { subscription_owner_id: billingUserId }
                    },
                ]);

            const { paddleUserId } = await givenSubscription(subId);
            const transaction: TransactionData = {
                amount: "1.00",
                currency: "USD",
                created_at: new Date().toISOString(),
                order_id: "order-456",
                product_id: 550789,
                receipt_url: "receipt.example",
                status: "completed"
            };
            await givenTransactions(paddleUserId, [transaction]);

            const response = await getBillingData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: billingUserEmail,

                subscription_expiry: subExpiry,
                subscription_id: subId,
                subscription_quantity: 1,
                subscription_sku: 'team-monthly',
                subscription_plan_id: 550789,
                subscription_status: "active",
                last_receipt_url: 'lru',
                cancel_url: 'cu',
                update_url: 'uu',

                transactions: [transaction],
                team_owner: { id: billingUserId, name: billingUserEmail },
                team_members: [
                    { id: billingUserId, name: billingUserEmail, locked: false }
                ]
            });
        });

        it("returns owner + error for team members beyond the subscribed quantity", async () => {
            const authToken = freshAuthToken();
            const billingUserId = "abc";
            const billingUserEmail = 'billinguser@example.com';
            const teamUserId = "def";
            const teamUserEmail = 'teamuser@example.com';

            const subId = id();
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
                    subscription_id: subId,
                    subscription_sku: 'team-monthly',
                    subscription_plan_id: 550789,
                    subscription_status: "active",
                    last_receipt_url: 'lru',
                    cancel_url: 'cu',
                    update_url: 'uu',
                }
            });

            const response = await getBillingData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: teamUserEmail,
                transactions: [],
                team_owner: {
                    id: billingUserId,
                    name: billingUserEmail,
                    error: 'member-beyond-owner-limit'
                }
            });
        });

        it("returns owner + error for team members beyond the subscribed quantity due to locks", async () => {
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
                    subscription_quantity: 3, // <-- 3 allowed, would be OK except for the locked license
                    subscription_expiry: subExpiry,
                    subscription_id: 2,
                    subscription_sku: 'team-monthly',
                    subscription_plan_id: 550789,
                    subscription_status: "active",
                    last_receipt_url: 'lru',
                    cancel_url: 'cu',
                    update_url: 'uu',
                }
            });

            const response = await getBillingData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: teamUserEmail,
                transactions: [],
                team_owner: {
                    id: billingUserId,
                    name: billingUserEmail,
                    error: 'member-beyond-owner-limit'
                }
            });
        });

        it("returns owner + error for team members with inconsistent membership data", async () => {
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
                    subscription_sku: 'team-monthly',
                    subscription_plan_id: 550789,
                    subscription_status: "active",
                    last_receipt_url: 'lru',
                    cancel_url: 'cu',
                    update_url: 'uu',
                }
            });

            const response = await getBillingData(functionServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: teamUserEmail,
                transactions: [],
                team_owner: {
                    id: billingUserId,
                    name: billingUserEmail,
                    error: 'inconsistent-owner-data'
                }
            });
        });
    });
});