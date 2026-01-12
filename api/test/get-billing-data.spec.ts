import * as net from 'net';
import jwt from 'jsonwebtoken';
import { DestroyableServer } from 'destroyable-server';
import moment from 'moment';

import { expect } from 'chai';

import {
    startAPI,
    publicKey,
    freshAuthToken,
    givenUser,
    givenAuthToken
} from './test-setup/setup.ts';
import { id } from './test-setup/utils.ts';
import { auth0Server  } from './test-setup/auth0.ts';
import {
    paddleServer,
    PADDLE_PORT,
    givenPaddleSubscription,
    givenPaddleTransactions,
} from './test-setup/paddle.ts';
import {
    givenPayProOrders,
    payproApiServer,
    PAYPRO_API_PORT
} from './test-setup/paypro.ts';

import { TransactionData } from '@httptoolkit/accounts';
import { LICENSE_LOCK_DURATION_MS, TeamOwnerMetadata } from '../src/user-data-facade.ts';

const asPaddleDate = (date: Date) => {
    return moment.utc(date).format('YYYY-MM-DD HH:mm:ss');
}

const getBillingData = (server: net.Server, authToken?: string) => fetch(
    `http://localhost:${(server.address() as net.AddressInfo).port}/api/get-billing-data`,
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

    describe("for unauthed users", () => {
        it("returns 401", async () => {
            const response = await getBillingData(apiServer);
            expect(response.status).to.equal(401);
        });
    });

    describe("for free users", () => {
        it("returns signed but empty data", async () => {
            const authToken = freshAuthToken();
            const userId = "abc";
            const userEmail = 'user@example.com';

            await givenUser(userId, userEmail);
            await givenAuthToken(authToken, userId);

            const response = await getBillingData(apiServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                user_id: userId,
                email: userEmail,
                transactions: [],
                can_manage_subscription: false
            });
        });
    });

    describe("for Pro users", () => {
        it("returns signed subscription data for older Paddle customers", async () => {
            const authToken = freshAuthToken();
            const userId = "abc";
            const userEmail = 'user@example.com';

            const subId = id();
            const subExpiry = Date.now();

            await givenUser(userId, userEmail, {
                subscription_expiry: subExpiry,
                subscription_id: subId,
                subscription_sku: 'pro-monthly',
                subscription_plan_id: 550380,
                subscription_status: "active",
                subscription_quantity: 1
            });
            await givenAuthToken(authToken, userId);

            const { paddleUserId } = await givenPaddleSubscription(subId);
            const transactionDate = new Date();
            transactionDate.setMilliseconds(0);
            await givenPaddleTransactions(paddleUserId, [{
                amount: "1.00",
                currency: "USD",
                created_at: asPaddleDate(transactionDate),
                order_id: "order-456",
                product_id: 550380,
                receipt_url: "receipt.example",
                status: "completed"
            }]);

            const response = await getBillingData(apiServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                user_id: userId,
                email: userEmail,
                subscription_expiry: subExpiry,
                subscription_sku: 'pro-monthly',
                subscription_plan_id: 550380,
                subscription_status: "active",
                subscription_quantity: 1,
                transactions: [{
                    amount: "1.00",
                    currency: "USD",
                    created_at: transactionDate.toISOString(),
                    order_id: "order-456",
                    sku: 'pro-monthly',
                    receipt_url: "receipt.example",
                    status: "completed"
                }],
                can_manage_subscription: true
            });
        });

        it("returns signed subscription data for new Paddle customers", async () => {
            const authToken = freshAuthToken();
            const userId = "abc";
            const userEmail = 'user@example.com';

            const subId = id();
            const subExpiry = Date.now();

            const { paddleUserId } = await givenPaddleSubscription(subId);

            await givenUser(userId, userEmail, {
                payment_provider: 'paddle',
                paddle_user_id: paddleUserId,
                subscription_id: subId.toString(),
                subscription_expiry: subExpiry,
                subscription_sku: 'pro-monthly',
                subscription_plan_id: 550380,
                subscription_status: "active",
                subscription_quantity: 1
            });
            await givenAuthToken(authToken, userId);

            const transactionDate = new Date();
            transactionDate.setMilliseconds(0);
            await givenPaddleTransactions(paddleUserId, [{
                amount: "1.00",
                currency: "USD",
                created_at: asPaddleDate(transactionDate),
                order_id: "order-456",
                product_id: 550380,
                receipt_url: "receipt.example",
                status: "completed"
            }]);

            const response = await getBillingData(apiServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                user_id: userId,
                email: userEmail,
                subscription_expiry: subExpiry,
                subscription_sku: 'pro-monthly',
                subscription_plan_id: 550380,
                subscription_status: "active",
                subscription_quantity: 1,
                transactions: [{
                    amount: "1.00",
                    currency: "USD",
                    created_at: transactionDate.toISOString(),
                    order_id: "order-456",
                    sku: 'pro-monthly',
                    receipt_url: "receipt.example",
                    status: "completed"
                }],
                can_manage_subscription: true
            });
        });

        it("returns signed subscription data for PayPro customers", async () => {
            const authToken = freshAuthToken();
            const userId = "abc";
            const userEmail = 'user@example.com';

            const subId = id();
            const subCreation = new Date();
            const subExpiry = Date.now();

            await givenUser(userId, userEmail, {
                payment_provider: 'paypro',
                subscription_id: subId.toString(),
                subscription_expiry: subExpiry,
                subscription_sku: 'pro-monthly',
                subscription_plan_id: 550380,
                subscription_status: "active",
                subscription_quantity: 1
            });
            await givenAuthToken(authToken, userId);

            const orderId = 12345;
            await givenPayProOrders(userEmail, [{
                orderId,
                billingCurrencyCode: 'EUR',
                billingTotalPrice: 60,
                customer: { email: userEmail },
                invoiceLink: 'https://invoice-url',
                orderStatusId: 5,
                orderStatusName: 'Processed',
                paymentMethodName: 'Credit card',
                createdAt: subCreation.toISOString().slice(0, -1), // PayPro's funky format
                orderItems: [{
                    billingPrice: 60,
                    sku: 'pro-annual',
                    orderItemName: 'HTTP Toolkit Pro (annual)',
                    quantity: 1
                }]
            }]);

            const response = await getBillingData(apiServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                user_id: userId,
                email: userEmail,
                subscription_expiry: subExpiry,
                subscription_sku: 'pro-monthly',
                subscription_plan_id: 550380,
                subscription_status: "active",
                subscription_quantity: 1,
                transactions: [{
                    amount: "60.00",
                    currency: "EUR",
                    created_at: subCreation.toISOString(),
                    order_id: "12345",
                    sku: 'pro-annual',
                    receipt_url: "https://invoice-url",
                    status: "completed"
                } as TransactionData],
                can_manage_subscription: true,
                update_url: 'https://cc.payproglobal.com/Customer/Account/Login'
            });
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

            await givenUser(teamUserId, teamUserEmail, { subscription_owner_id: billingUserId });
            await givenAuthToken(authToken, teamUserId);

            await givenUser(billingUserId, billingUserEmail, {
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
            });

            const response = await getBillingData(apiServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                user_id: teamUserId,
                email: teamUserEmail,
                team_owner: {
                    id: billingUserId,
                    name: billingUserEmail
                },
                transactions: [],
                can_manage_subscription: false
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

            await givenUser(billingUserId, billingUserEmail, {
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
            } as TeamOwnerMetadata);
            await givenAuthToken(authToken, billingUserId);

            await auth0Server.forGet('/api/v2/users')
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

            const { paddleUserId } = await givenPaddleSubscription(subId);
            const transactionDate = new Date();
            transactionDate.setMilliseconds(0);
            await givenPaddleTransactions(paddleUserId, [{
                amount: "1.00",
                currency: "USD",
                created_at: asPaddleDate(transactionDate),
                order_id: "order-456",
                product_id: 550789,
                receipt_url: "receipt.example",
                status: "completed"
            }]);

            const response = await getBillingData(apiServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                user_id: billingUserId,
                email: billingUserEmail,

                subscription_expiry: subExpiry,
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
                can_manage_subscription: true,

                transactions: [{
                    amount: "1.00",
                    currency: "USD",
                    created_at: transactionDate.toISOString(),
                    order_id: "order-456",
                    sku: 'team-monthly',
                    receipt_url: "receipt.example",
                    status: "completed"
                }],
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

            await givenUser(billingUserId, billingUserEmail, {
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
            });
            await givenAuthToken(authToken, billingUserId);

            await auth0Server.forGet('/api/v2/users')
                .withQuery({ q: `app_metadata.subscription_owner_id:${billingUserId}` })
                .thenJson(200, [
                    {
                        user_id: billingUserId,
                        email: billingUserEmail,
                        app_metadata: { subscription_owner_id: billingUserId }
                    },
                ]);

            const { paddleUserId } = await givenPaddleSubscription(subId);
            const transactionDate = new Date();
            transactionDate.setMilliseconds(0);

            await givenPaddleTransactions(paddleUserId, [{
                amount: "1.00",
                currency: "USD",
                created_at: asPaddleDate(transactionDate),
                order_id: "order-456",
                product_id: 550789,
                receipt_url: "receipt.example",
                status: "completed"
            }]);

            const response = await getBillingData(apiServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                user_id: billingUserId,
                email: billingUserEmail,

                subscription_expiry: subExpiry,
                subscription_quantity: 1,
                subscription_sku: 'team-monthly',
                subscription_plan_id: 550789,
                subscription_status: "active",
                last_receipt_url: 'lru',
                cancel_url: 'cu',
                update_url: 'uu',
                can_manage_subscription: true,

                transactions: [{
                    amount: "1.00",
                    currency: "USD",
                    created_at: transactionDate.toISOString(),
                    order_id: "order-456",
                    sku: 'team-monthly',
                    receipt_url: "receipt.example",
                    status: "completed"
                }],
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

            await givenUser(teamUserId, teamUserEmail, {
                subscription_owner_id: billingUserId
            });
            await givenAuthToken(authToken, teamUserId);

            await givenUser(billingUserId, billingUserEmail, {
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
            });

            const response = await getBillingData(apiServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                user_id: teamUserId,
                email: teamUserEmail,
                transactions: [],
                can_manage_subscription: false,
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

            await givenUser(teamUserId, teamUserEmail, {
                subscription_owner_id: billingUserId
            });
            await givenAuthToken(authToken, teamUserId);

            await givenUser(billingUserId, billingUserEmail, {
                team_member_ids: ['123', '456', teamUserId],
                locked_licenses: [new Date(2050, 0, 0).getTime()], // Locked for ~30 years
                subscription_quantity: 3, // <-- 3 allowed, would be OK except for the locked license
                subscription_expiry: subExpiry,
                subscription_id: '2',
                subscription_sku: 'team-monthly',
                subscription_plan_id: 550789,
                subscription_status: "active",
                last_receipt_url: 'lru',
                cancel_url: 'cu',
                update_url: 'uu',
            });

            const response = await getBillingData(apiServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                user_id: teamUserId,
                email: teamUserEmail,
                transactions: [],
                can_manage_subscription: false,
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

            await givenUser(teamUserId, teamUserEmail, {
                subscription_owner_id: billingUserId
            });
            await givenAuthToken(authToken, teamUserId);

            await givenUser(billingUserId, billingUserEmail, {
                team_member_ids: [], // <-- doesn't include this user
                subscription_expiry: subExpiry,
                subscription_id: '2',
                subscription_sku: 'team-monthly',
                subscription_plan_id: 550789,
                subscription_status: "active",
                last_receipt_url: 'lru',
                cancel_url: 'cu',
                update_url: 'uu',
            });

            const response = await getBillingData(apiServer, authToken);
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                user_id: teamUserId,
                email: teamUserEmail,
                transactions: [],
                can_manage_subscription: false,
                team_owner: {
                    id: billingUserId,
                    name: billingUserEmail,
                    error: 'inconsistent-owner-data'
                }
            });
        });
    });
});