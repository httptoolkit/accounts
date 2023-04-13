import * as crypto from 'crypto';
import * as net from 'net';
import fetch from 'node-fetch';
import moment from 'moment';
import stoppable from 'stoppable';

import { expect } from 'chai';

import {
    startServer,
    privateKey,
    auth0Server,
    AUTH0_PORT,
    profitwellApiServer,
    PROFITWELL_API_PORT,
    givenUser,
    givenNoUsers
} from './test-util';
import { serializeWebhookData, PaddleWebhookData, UnsignedWebhookData } from '../src/paddle';

const signBody = (body: UnsignedWebhookData) => {
    const serializedData = serializeWebhookData(body);
    const signer = crypto.createSign('sha1');
    signer.update(serializedData);
    signer.end();

    return signer.sign(privateKey, 'base64');
}

const getPaddleWebhookData = (unsignedBody: Partial<PaddleWebhookData>) => {
    const body = Object.assign({
        p_signature: signBody(unsignedBody as PaddleWebhookData)
    }, unsignedBody) as PaddleWebhookData;

    return {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(
            body as unknown as { [key: string]: string }
        ).toString()
    };
}

const triggerWebhook = async (
    server: net.Server,
    unsignedBody: Partial<PaddleWebhookData>,
    options: { expectedStatus: number } = { expectedStatus: 200 }
) => {
    const functionServerUrl = `http://localhost:${(server.address() as net.AddressInfo).port}`;

    const result = await fetch(
        `${functionServerUrl}/.netlify/functions/paddle-webhook`,
        getPaddleWebhookData(unsignedBody)
    );

    expect(result.status).to.equal(options.expectedStatus);
}

describe('Paddle webhooks', () => {

    let functionServer: stoppable.StoppableServer;

    beforeEach(async () => {
        functionServer = await startServer();

        await auth0Server.start(AUTH0_PORT);
        await auth0Server.forPost('/oauth/token').thenReply(200);

        // We don't test Profitwell for now, we just need it to not crash:
        await profitwellApiServer.start(PROFITWELL_API_PORT);
        await profitwellApiServer.forAnyRequest().thenReply(200);
    });

    afterEach(async () => {
        await new Promise((resolve) => functionServer.stop(resolve));
        await auth0Server.stop();
        await profitwellApiServer.stop();
    });

    describe("for Pro subscriptions", () => {

        it('successfully handle new subscriptions for an existing user', async () => {
            const userId = "abc";
            const userEmail = 'user@example.com';
            givenUser(userId, userEmail);

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenReply(200);

            const nextRenewal = moment('2025-01-01');

            await triggerWebhook(functionServer, {
                alert_name: 'subscription_created',
                status: 'active',
                email: userEmail,
                user_id: '123',
                subscription_id: '456',
                subscription_plan_id: '550382', // Pro-annual
                next_bill_date: nextRenewal.format('YYYY-MM-DD'),
                quantity: '1'
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'active',
                    payment_provider: 'paddle',
                    paddle_user_id: '123',
                    subscription_id: '456',
                    subscription_sku: 'pro-annual',
                    subscription_plan_id: 550382,
                    subscription_quantity: 1,
                    subscription_expiry: nextRenewal.add(1, 'days').valueOf()
                }
            });
        });

        it('successfully handle new subscriptions for an new user', async () => {
            const userEmail = 'user@example.com';
            givenNoUsers();

            const userId = "qwe";
            const userCreate = await auth0Server
                .forPost('/api/v2/users')
                .thenJson(201, {
                    user_id: userId,
                    app_metadata: {}
                });

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenReply(200);

            const nextRenewal = moment('2025-01-01');

            await triggerWebhook(functionServer, {
                alert_name: 'subscription_created',
                status: 'active',
                email: userEmail,
                user_id: '123',
                subscription_id: '456',
                subscription_plan_id: '550382', // Pro-annual
                next_bill_date: nextRenewal.format('YYYY-MM-DD'),
                quantity: '1'
            });

            const createRequests = await userCreate.getSeenRequests();
            expect(createRequests.length).to.equal(1);
            expect(await createRequests[0].body.getJson()).to.deep.equal({
                email: userEmail,
                connection: 'email',
                email_verified: true,
                app_metadata: {}
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'active',
                    payment_provider: 'paddle',
                    paddle_user_id: '123',
                    subscription_id: '456',
                    subscription_sku: 'pro-annual',
                    subscription_plan_id: 550382,
                    subscription_quantity: 1,
                    subscription_expiry: nextRenewal.add(1, 'days').valueOf()
                }
            });
        });

        it('should accept new Pro subscriptions for an ex-Team user', async () => {
            const ownerId = "team-owner";
            const ownerEmail = 'owner@example.com';
            const memberId = "team-member";
            const memberEmail = 'member@example.com';

            givenUser(ownerId, ownerEmail, {
                subscription_sku: 'team-annual',
                team_member_ids: [
                    'other-member-id',
                    memberId
                ],

                // Cancelled and expired:
                subscription_status: 'cancelled',
                subscription_expiry: Date.now() - 1
            })

            givenUser(memberId, memberEmail, {
                subscription_owner_id: ownerId
            });

            const ownerUpdate = await auth0Server
                .forPatch('/api/v2/users/' + ownerId)
                .thenReply(200);

            const memberUpdate = await auth0Server
                .forPatch('/api/v2/users/' + memberId)
                .thenReply(200);

            const nextRenewal = moment('2025-01-01');

            await triggerWebhook(functionServer, {
                alert_name: 'subscription_created',
                status: 'active',
                email: memberEmail,
                user_id: '123',
                subscription_id: '456',
                subscription_plan_id: '550382', // Pro-annual
                next_bill_date: nextRenewal.format('YYYY-MM-DD'),
                quantity: '1'
            });

            const ownerUpdateRequests = await ownerUpdate.getSeenRequests();
            expect(ownerUpdateRequests.length).to.equal(1);
            expect(await ownerUpdateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    team_member_ids: ['other-member-id']
                }
            });

            const memberUpdateRequests = await memberUpdate.getSeenRequests();
            expect(memberUpdateRequests.length).to.equal(1);
            expect(await memberUpdateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_owner_id: null,

                    subscription_status: 'active',
                    payment_provider: 'paddle',
                    paddle_user_id: '123',
                    subscription_id: '456',
                    subscription_sku: 'pro-annual',
                    subscription_plan_id: 550382,
                    subscription_quantity: 1,
                    subscription_expiry: nextRenewal.add(1, 'days').valueOf()
                }
            });
        });

        it('should reject new Pro subscriptions for an active Team user', async () => {
            const ownerId = "team-owner";
            const ownerEmail = 'owner@example.com';
            const memberId = "team-member";
            const memberEmail = 'member@example.com';

            givenUser(ownerId, ownerEmail, {
                subscription_sku: 'team-annual',
                team_member_ids: [
                    'other-member-id',
                    memberId
                ],

                // Active and unexpired:
                subscription_status: 'active',
                subscription_expiry: Date.now() + 10000
            })

            givenUser(memberId, memberEmail, {
                subscription_owner_id: ownerId
            });

            const ownerUpdate = await auth0Server
                .forPatch('/api/v2/users/' + ownerId)
                .thenReply(200);

            const memberUpdate = await auth0Server
                .forPatch('/api/v2/users/' + memberId)
                .thenReply(200);

            const nextRenewal = moment('2025-01-01');

            await triggerWebhook(functionServer, {
                alert_name: 'subscription_created',
                status: 'active',
                email: memberEmail,
                user_id: '123',
                subscription_id: '456',
                subscription_plan_id: '550382', // Pro-annual
                next_bill_date: nextRenewal.format('YYYY-MM-DD'),
                quantity: '1'
            }, {
                expectedStatus: 409
            });

            const ownerUpdateRequests = await ownerUpdate.getSeenRequests();
            expect(ownerUpdateRequests.length).to.equal(0);

            const memberUpdateRequests = await memberUpdate.getSeenRequests();
            expect(memberUpdateRequests.length).to.equal(0);
        });

        it('should successfully renew subscriptions', async () => {
            const userId = "abc";
            const userEmail = 'user@example.com';
            const nextRenewal = moment('2025-01-01');

            givenUser(userId, userEmail, {
                subscription_status: 'active',
                payment_provider: 'paddle',
                paddle_user_id: '123',
                subscription_id: 456,
                subscription_sku: 'pro-annual',
                subscription_plan_id: 550382,
                subscription_expiry: nextRenewal.subtract(30, 'days').valueOf()
            });

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenReply(200);

            await triggerWebhook(functionServer, {
                alert_name: 'subscription_payment_succeeded',
                status: 'active',
                email: userEmail,
                user_id: '123',
                subscription_id: '456',
                subscription_plan_id: '550382', // Pro-annual
                next_bill_date: nextRenewal.format('YYYY-MM-DD'),
                quantity: '1'
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'active',
                    payment_provider: 'paddle',
                    paddle_user_id: '123',
                    subscription_id: '456',
                    subscription_sku: 'pro-annual',
                    subscription_plan_id: 550382,
                    subscription_quantity: 1,
                    subscription_expiry: nextRenewal.add(1, 'days').valueOf()
                }
            });
        });

        it('successfully cancel subscriptions on request', async () => {
            const userId = "abc";
            const userEmail = 'user@example.com';
            const cancellationDate = moment('2025-01-01');

            givenUser(userId, userEmail, {
                subscription_status: 'active',
                paddle_user_id: 123,
                subscription_id: 456,
                subscription_sku: 'pro-annual',
                subscription_plan_id: 550382,
                subscription_expiry: cancellationDate.add(30, 'days').valueOf()
            });

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenReply(200);

            await triggerWebhook(functionServer, {
                alert_name: 'subscription_cancelled',
                email: userEmail,
                user_id: '123',
                subscription_id: '456',
                subscription_plan_id: '550382', // Pro-annual
                cancellation_effective_date: cancellationDate.format('YYYY-MM-DD')
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'deleted',
                    payment_provider: 'paddle',
                    paddle_user_id: '123',
                    subscription_id: '456',
                    subscription_sku: 'pro-annual',
                    subscription_plan_id: 550382,
                    subscription_expiry: cancellationDate.valueOf()
                }
            });
        });

        it('successfully cancel subscriptions after failed payments', async () => {
            const userId = "abc";
            const userEmail = 'user@example.com';

            const currentDate = moment('2020-01-01');
            const finalDate = moment('2020-01-07');

            givenUser(userId, userEmail, {
                subscription_status: 'active',
                paddle_user_id: 123,
                subscription_id: 456,
                subscription_sku: 'pro-annual',
                subscription_plan_id: 550382,
                subscription_expiry: currentDate.valueOf()
            });

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenReply(200);

            // Initial renewal failure:

            await triggerWebhook(functionServer, {
                alert_name: 'subscription_updated',
                status: 'past_due',
                email: userEmail,
                user_id: '123',
                subscription_id: '456',
                subscription_plan_id: '550382', // Pro-annual
                next_bill_date: currentDate.format('YYYY-MM-DD'),
                new_quantity: '1'
            })

            await triggerWebhook(functionServer, {
                alert_name: 'subscription_payment_failed',
                status: 'past_due',
                email: userEmail,
                user_id: '123',
                subscription_id: '456',
                subscription_plan_id: '550382', // Pro-annual
                next_retry_date: finalDate.format('YYYY-MM-DD')
            });

            let updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(2);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'past_due',
                    payment_provider: 'paddle',
                    paddle_user_id: '123',
                    subscription_id: '456',
                    subscription_sku: 'pro-annual',
                    subscription_plan_id: 550382,
                    subscription_quantity: 1,
                    subscription_expiry: currentDate.add(1, 'days').valueOf()
                }
            });
            expect(await updateRequests[1].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'past_due',
                    payment_provider: 'paddle',
                    paddle_user_id: '123',
                    subscription_id: '456',
                    subscription_sku: 'pro-annual',
                    subscription_plan_id: 550382,
                    subscription_expiry: finalDate.add(1, 'days').valueOf()
                }
            });

            // Final renewal failure:

            await triggerWebhook(functionServer, {
                alert_name: 'subscription_payment_failed',
                status: 'past_due',
                email: userEmail,
                user_id: '123',
                subscription_id: '456',
                subscription_plan_id: '550382', // Pro-annual
                // N.B: no next_retry_date, we're done
            });

            await triggerWebhook(functionServer, {
                alert_name: 'subscription_cancelled',
                email: userEmail,
                user_id: '123',
                subscription_id: '456',
                subscription_plan_id: '550382', // Pro-annual
                cancellation_effective_date: finalDate.format('YYYY-MM-DD')
            });

            updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(4);
            expect(await updateRequests[2].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'deleted',
                    payment_provider: 'paddle',
                    paddle_user_id: '123',
                    subscription_id: '456',
                    subscription_sku: 'pro-annual',
                    subscription_plan_id: 550382
                }
            });
            expect(await updateRequests[3].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'deleted',
                    payment_provider: 'paddle',
                    paddle_user_id: '123',
                    subscription_id: '456',
                    subscription_sku: 'pro-annual',
                    subscription_plan_id: 550382,
                    subscription_expiry: finalDate.valueOf()
                }
            });
        });
    });

    describe("for Team subscriptions", () => {

        it('successfully handle new subscriptions for an existing user', async () => {
            const userId = "abc";
            const userEmail = 'user@example.com';
            givenUser(userId, userEmail);

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenReply(200);

            const nextRenewal = moment('2025-01-01');

            await triggerWebhook(functionServer, {
                alert_name: 'subscription_created',
                status: 'active',
                email: userEmail,
                user_id: '123',
                subscription_id: '456',
                subscription_plan_id: '550789', // Team-monthly
                next_bill_date: nextRenewal.format('YYYY-MM-DD'),
                quantity: '5'
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'active',
                    payment_provider: 'paddle',
                    paddle_user_id: '123',
                    subscription_id: '456',
                    subscription_sku: 'team-monthly',
                    subscription_plan_id: 550789,
                    subscription_quantity: 5,
                    subscription_expiry: nextRenewal.add(1, 'days').valueOf(),
                    team_member_ids: [],
                    locked_licenses: []
                }
            });
        });

        it('successfully handle new subscriptions for an new user', async () => {
            const userEmail = 'user@example.com';
            givenNoUsers();

            const userId = "qwe";
            const userCreate = await auth0Server
                .forPost('/api/v2/users')
                .thenJson(201, {
                    user_id: userId,
                    app_metadata: {}
                });

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenReply(200);

            const nextRenewal = moment('2025-01-01');

            await triggerWebhook(functionServer, {
                alert_name: 'subscription_created',
                status: 'active',
                email: userEmail,
                user_id: '123',
                subscription_id: '456',
                subscription_plan_id: '550789', // Team-monthly
                next_bill_date: nextRenewal.format('YYYY-MM-DD'),
                quantity: '5'
            });

            const createRequests = await userCreate.getSeenRequests();
            expect(createRequests.length).to.equal(1);
            expect(await createRequests[0].body.getJson()).to.deep.equal({
                email: userEmail,
                connection: 'email',
                email_verified: true,
                app_metadata: {}
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'active',
                    payment_provider: 'paddle',
                    paddle_user_id: '123',
                    subscription_id: '456',
                    subscription_sku: 'team-monthly',
                    subscription_plan_id: 550789,
                    subscription_quantity: 5,
                    subscription_expiry: nextRenewal.add(1, 'days').valueOf(),
                    team_member_ids: [],
                    locked_licenses: []
                }
            });
        });

        it('successfully handle subscriptions renewals', async () => {
            const userId = "abc";
            const userEmail = 'user@example.com';
            givenUser(userId, userEmail, {
                team_member_ids: ['teamMemberId']
            });

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenReply(200);

            const nextRenewal = moment('2025-01-01');

            await triggerWebhook(functionServer, {
                alert_name: 'subscription_payment_succeeded',
                status: 'active',
                email: userEmail,
                user_id: '123',
                subscription_id: '456',
                quantity: '5',
                subscription_plan_id: '550789', // Team-monthly
                next_bill_date: nextRenewal.format('YYYY-MM-DD'),
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'active',
                    payment_provider: 'paddle',
                    paddle_user_id: '123',
                    subscription_id: '456',
                    subscription_sku: 'team-monthly',
                    subscription_plan_id: 550789,
                    subscription_quantity: 5,
                    subscription_expiry: nextRenewal.add(1, 'days').valueOf(),
                    locked_licenses: []
                    // Doesn't update team_member_ids - that's already set.
                }
            });
        });

        it('cleans up expired locks at subscription renewal', async () => {
            const userId = "abc";
            const userEmail = 'user@example.com';
            givenUser(userId, userEmail, {
                team_member_ids: ['teamMemberId'],
                locked_licenses: [
                    new Date(2000, 0, 0).getTime(),
                    new Date(2050, 0, 0).getTime()
                ]
            });

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenReply(200);

            const nextRenewal = moment('2025-01-01');

            await triggerWebhook(functionServer, {
                alert_name: 'subscription_payment_succeeded',
                status: 'active',
                email: userEmail,
                user_id: '123',
                subscription_id: '456',
                quantity: '5',
                subscription_plan_id: '550789', // Team-monthly
                next_bill_date: nextRenewal.format('YYYY-MM-DD'),
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'active',
                    payment_provider: 'paddle',
                    paddle_user_id: '123',
                    subscription_id: '456',
                    subscription_sku: 'team-monthly',
                    subscription_plan_id: 550789,
                    subscription_expiry: nextRenewal.add(1, 'days').valueOf(),
                    subscription_quantity: 5,
                    locked_licenses: [new Date(2050, 0, 0).getTime()] // Removes only the expired lock
                    // Doesn't update team_member_ids - that's already set.
                }
            });
        });

    });

    describe("for disputed payments", () => {

        it("should ban the user until they contact support", async () => {
            const userId = "abc";
            const userEmail = 'user@example.com';
            givenUser(userId, userEmail);

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenReply(200);

            await triggerWebhook(functionServer, {
                alert_name: 'payment_dispute_created',
                email: userEmail
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    banned: true
                }
            });
        });

    });
});