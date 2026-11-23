import * as crypto from 'crypto';
import * as net from 'net';
import moment from 'moment';
import { DestroyableServer } from 'destroyable-server';

import { expect } from 'chai';

import type { MockedEndpoint } from 'mockttp';

import {
    startAPI,
    privateKey,
    givenUser,
    givenNoUsers,
    givenBlackFridayDealEnded,
    uniqueUserId
} from './test-setup/setup.ts';
import { auth0Server } from './test-setup/auth0.ts';
import { testDB } from './test-setup/database.ts';
import { waitForRequests } from './test-setup/utils.ts';
import { paddleServer, PADDLE_PORT } from './test-setup/paddle.ts';

import { serializeWebhookData, UnsignedWebhookData } from '../src/paddle.ts';

type FormData = { [key: string]: string };

const sign = (data: FormData) => {
    const signer = crypto.createSign('sha1');
    signer.update(serializeWebhookData(data as unknown as UnsignedWebhookData));
    signer.end();

    return signer.sign(privateKey, 'base64');
};

const signedForm = (data: FormData) =>
    new URLSearchParams({ ...data, p_signature: sign(data) }).toString();

const apiUrl = (server: net.Server, path: string) =>
    `http://localhost:${(server.address() as net.AddressInfo).port}/api/${path}`;

const PURCHASE_TIME = '2026-11-23 11:39:53';
const RECEIPT_URL = 'https://my.paddle.com/receipt/83115903/356139350-chre3d7dd803dda-8086a92b04';
const EXPECTED_EXPIRY = moment.utc(PURCHASE_TIME).add(100, 'years').valueOf();

// The payment_succeeded event Paddle sends for a completed order, as form data:
const purchaseData = (overrides: FormData = {}): FormData => ({
    alert_id: '376115962',
    alert_name: 'payment_succeeded',
    balance_currency: 'EUR',
    balance_earnings: '100',
    balance_fee: '5',
    balance_gross: '120',
    balance_tax: '15',
    checkout_id: '356139350-chre3d7dd803dda-8086a92b04',
    country: 'ES',
    coupon: 'BLACKFRIDAY26',
    currency: 'EUR',
    custom_data: '',
    customer_name: 'Test User',
    earnings: '100',
    email: 'user@example.com',
    event_time: PURCHASE_TIME,
    fee: '5',
    ip: '',
    marketing_consent: '0',
    order_id: '83115903',
    passthrough: '',
    payment_method: 'card',
    payment_tax: '15',
    product_id: '932080',
    product_name: 'HTTP Toolkit Lifetime',
    quantity: '1',
    receipt_url: RECEIPT_URL,
    sale_gross: '120',
    used_price_override: '1',
    ...overrides
});

const triggerWebhook = async (
    server: net.Server,
    data: FormData,
    { expectedStatus = 200 }: { expectedStatus?: number } = {}
) => {
    const result = await fetch(apiUrl(server, 'paddle-webhook'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: signedForm(data)
    });

    expect(result.status).to.equal(expectedStatus);
};

const getUserMetadata = async (email: string) => {
    const result = await testDB.query(`SELECT app_metadata FROM users WHERE email = $1`, [email]);
    expect(result.rows.length).to.equal(1);
    return result.rows[0].app_metadata;
};

const LIFETIME_LICENSE = {
    subscription_status: 'active',
    subscription_sku: 'pro-perpetual',
    subscription_quantity: 1,
    subscription_expiry: EXPECTED_EXPIRY,
    payment_provider: 'paddle',
    paddle_order_id: '83115903',
    last_receipt_url: RECEIPT_URL
};

describe('Paddle lifetime licenses', () => {

    let apiServer: DestroyableServer;

    let userId: string;
    const userEmail = 'user@example.com';

    let auth0UserUpdate: MockedEndpoint;

    beforeEach(async () => {
        apiServer = await startAPI();
        await paddleServer.start(PADDLE_PORT);

        userId = uniqueUserId('user');
        auth0UserUpdate = await auth0Server.forPatch('/api/v2/users/' + userId).thenJson(200, {});
    });

    afterEach(async () => {
        await apiServer.destroy();
        await paddleServer.stop();
    });

    describe("when an order is paid for", () => {

        it("activates a license for an existing user", async () => {
            await givenUser(userId, userEmail);

            await triggerWebhook(apiServer, purchaseData());

            expect(await getUserMetadata(userEmail)).to.deep.equal(LIFETIME_LICENSE);
        });

        it("mirrors the license to Auth0", async () => {
            await givenUser(userId, userEmail);

            await triggerWebhook(apiServer, purchaseData());

            const updateRequests = await waitForRequests(auth0UserUpdate, 1);
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    ...LIFETIME_LICENSE,
                    subscription_id: null,
                    paddle_user_id: null,
                    subscription_coupon: null,
                    update_url: null,
                    cancel_url: null
                }
            });
        });

        it("still activates orders that complete after the Black Friday deal has ended", async () => {
            givenBlackFridayDealEnded();
            await givenUser(userId, userEmail);

            await triggerWebhook(apiServer, purchaseData());

            expect(await getUserMetadata(userEmail)).to.deep.equal(LIFETIME_LICENSE);
        });

        it("activates a license for a new user", async () => {
            await givenNoUsers();
            await auth0Server.forPost('/api/v2/users').thenJson(201, {
                user_id: userId,
                app_metadata: {}
            });

            await triggerWebhook(apiServer, purchaseData());

            expect(await getUserMetadata(userEmail)).to.deep.equal(LIFETIME_LICENSE);
        });

        it("ignores the casing of the customer's email", async () => {
            await givenUser(userId, userEmail);

            await triggerWebhook(apiServer, purchaseData({ email: 'User@Example.com' }));

            expect(await getUserMetadata(userEmail)).to.deep.equal(LIFETIME_LICENSE);
        });

        it("rejects requests with an invalid signature", async () => {
            await givenUser(userId, userEmail);

            const result = await fetch(apiUrl(apiServer, 'paddle-webhook'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    ...purchaseData({ email: 'attacker@example.com' }),
                    p_signature: sign(purchaseData())
                }).toString()
            });

            expect(result.status).to.equal(500);
            expect(await getUserMetadata(userEmail)).to.deep.equal({});
        });

        it("rejects unsigned requests", async () => {
            await givenUser(userId, userEmail);

            const result = await fetch(apiUrl(apiServer, 'paddle-webhook'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(purchaseData()).toString()
            });

            expect(result.status).to.equal(500);
            expect(await getUserMetadata(userEmail)).to.deep.equal({});
        });

        it("ignores orders for other products", async () => {
            await givenUser(userId, userEmail);

            await triggerWebhook(apiServer, purchaseData({ product_id: '123456' }));

            expect(await getUserMetadata(userEmail)).to.deep.equal({});
        });

        it("changes nothing if the same payment is reported twice", async () => {
            await givenUser(userId, userEmail);

            await triggerWebhook(apiServer, purchaseData());
            await triggerWebhook(apiServer, purchaseData({ event_time: '2027-01-01 00:00:00' }));

            expect(await getUserMetadata(userEmail)).to.deep.equal(LIFETIME_LICENSE);
        });

        it("replaces and cancels an existing Paddle subscription", async () => {
            await givenUser(userId, userEmail, {
                subscription_status: 'active',
                payment_provider: 'paddle',
                paddle_user_id: '123',
                subscription_id: '456',
                subscription_sku: 'pro-annual',
                subscription_quantity: 1,
                subscription_expiry: Date.now() + 1000 * 60 * 60 * 24 * 100,
                subscription_coupon: 'DISCOUNT',
                last_receipt_url: 'https://receipt.example',
                update_url: 'https://update.example',
                cancel_url: 'https://cancel.example'
            });

            const cancelEndpoint = await paddleServer
                .forPost('/api/2.0/subscription/users_cancel')
                .thenJson(200, { success: true });

            await triggerWebhook(apiServer, purchaseData());

            expect(await getUserMetadata(userEmail)).to.deep.equal(LIFETIME_LICENSE);

            const cancelRequests = await cancelEndpoint.getSeenRequests();
            expect(cancelRequests.length).to.equal(1);
            expect((await cancelRequests[0].body.getFormData())!.subscription_id).to.equal('456');
        });

        it("still activates the license if the old subscription can't be cancelled", async () => {
            await givenUser(userId, userEmail, {
                subscription_status: 'active',
                payment_provider: 'paddle',
                subscription_id: '456',
                subscription_sku: 'pro-annual',
                subscription_quantity: 1,
                subscription_expiry: Date.now() + 1000 * 60 * 60 * 24 * 100
            });

            await paddleServer
                .forPost('/api/2.0/subscription/users_cancel')
                .thenJson(200, { success: false, error: { code: 1, message: 'Nope' } });

            await triggerWebhook(apiServer, purchaseData());

            expect(await getUserMetadata(userEmail)).to.deep.equal(LIFETIME_LICENSE);
        });

        it("doesn't try to cancel a subscription that's already cancelled", async () => {
            await givenUser(userId, userEmail, {
                subscription_status: 'deleted',
                payment_provider: 'paddle',
                subscription_id: '456',
                subscription_sku: 'pro-annual',
                subscription_quantity: 1,
                subscription_expiry: Date.now() + 1000 * 60 * 60 * 24 * 100
            });

            const cancelEndpoint = await paddleServer
                .forPost('/api/2.0/subscription/users_cancel')
                .thenJson(200, { success: true });

            await triggerWebhook(apiServer, purchaseData());

            expect(await getUserMetadata(userEmail)).to.deep.equal(LIFETIME_LICENSE);
            expect((await cancelEndpoint.getSeenRequests()).length).to.equal(0);
        });

        it("replaces an earlier lifetime license with the new order", async () => {
            await givenUser(userId, userEmail, { ...LIFETIME_LICENSE, paddle_order_id: '111' });

            await triggerWebhook(apiServer, purchaseData());

            expect(await getUserMetadata(userEmail)).to.deep.equal(LIFETIME_LICENSE);
        });

        it("rejects orders from the owner of an active team", async () => {
            const teamSubscription = {
                subscription_status: 'active',
                payment_provider: 'paddle',
                subscription_id: '456',
                subscription_sku: 'team-annual',
                subscription_quantity: 5,
                subscription_expiry: Date.now() + 1000 * 60 * 60 * 24 * 100,
                team_member_ids: []
            };
            await givenUser(userId, userEmail, teamSubscription);

            await triggerWebhook(apiServer, purchaseData(), { expectedStatus: 409 });

            expect(await getUserMetadata(userEmail)).to.deep.equal(teamSubscription);
        });

        it("rejects orders from a member of an active team", async () => {
            const ownerId = uniqueUserId('team-owner');
            await givenUser(ownerId, 'owner@example.com', {
                subscription_status: 'active',
                payment_provider: 'paddle',
                subscription_sku: 'team-annual',
                subscription_expiry: Date.now() + 10000,
                team_member_ids: [userId]
            });
            await givenUser(userId, userEmail, { subscription_owner_id: ownerId });

            await triggerWebhook(apiServer, purchaseData(), { expectedStatus: 409 });

            expect(await getUserMetadata(userEmail)).to.deep.equal({ subscription_owner_id: ownerId });
        });

        it("rejects orders from a member of a team that has ended", async () => {
            const ownerId = uniqueUserId('team-owner');
            const ownerData = {
                subscription_status: 'deleted',
                payment_provider: 'paddle',
                subscription_sku: 'team-annual',
                subscription_expiry: Date.now() - 10000,
                team_member_ids: ['other-member', userId]
            };
            await givenUser(ownerId, 'owner@example.com', ownerData);
            await givenUser(userId, userEmail, { subscription_owner_id: ownerId });

            await triggerWebhook(apiServer, purchaseData(), { expectedStatus: 409 });

            expect(await getUserMetadata(userEmail)).to.deep.equal({ subscription_owner_id: ownerId });
            expect(await getUserMetadata('owner@example.com')).to.deep.equal(ownerData);
        });

        it("rejects orders from the owner of a team that has ended", async () => {
            const teamSubscription = {
                subscription_status: 'deleted',
                payment_provider: 'paddle',
                subscription_id: '456',
                subscription_sku: 'team-annual',
                subscription_quantity: 5,
                subscription_expiry: Date.now() - 1000 * 60 * 60 * 24 * 100,
                team_member_ids: []
            };
            await givenUser(userId, userEmail, teamSubscription);

            await triggerWebhook(apiServer, purchaseData(), { expectedStatus: 409 });

            expect(await getUserMetadata(userEmail)).to.deep.equal(teamSubscription);
        });

        it("doesn't cancel anything or contact Auth0 for rejected team orders", async () => {
            await givenUser(userId, userEmail, {
                subscription_status: 'active',
                payment_provider: 'paddle',
                subscription_id: '456',
                subscription_sku: 'team-annual',
                subscription_quantity: 5,
                subscription_expiry: Date.now() + 1000 * 60 * 60 * 24 * 100,
                team_member_ids: []
            });
            const cancelEndpoint = await paddleServer
                .forPost('/api/2.0/subscription/users_cancel')
                .thenJson(200, { success: true });

            await triggerWebhook(apiServer, purchaseData(), { expectedStatus: 409 });

            expect((await cancelEndpoint.getSeenRequests()).length).to.equal(0);
            expect((await auth0UserUpdate.getSeenRequests()).length).to.equal(0);
        });
    });

    describe("when Paddle asks for the order's confirmation message", () => {

        it(`responds to requests without changing anything`, async () => {
            await givenUser(userId, userEmail);

            const response = await fetch(apiUrl(apiServer, 'paddle-purchase-webhook'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'p_product_id=932080&p_order_id=83115903'
            });

            expect(response.status).to.equal(200);
            expect(await response.text()).to.include('lifetime license is now active');
            expect(await getUserMetadata(userEmail)).to.deep.equal({});
        });
    });

    describe("once a license is active", () => {

        beforeEach(async () => {
            await givenUser(userId, userEmail, LIFETIME_LICENSE);
        });

        const subscriptionEvent = (overrides: FormData): FormData => ({
            email: userEmail,
            user_id: '123',
            subscription_id: '456',
            subscription_plan_id: '550382', // Pro-annual
            ...overrides
        });

        it("ignores the cancellation of a subscription it replaced", async () => {
            await triggerWebhook(apiServer, subscriptionEvent({
                alert_name: 'subscription_cancelled',
                status: 'deleted',
                cancellation_effective_date: '2027-01-01'
            }));

            expect(await getUserMetadata(userEmail)).to.deep.equal(LIFETIME_LICENSE);
        });

        it("ignores payments for a subscription it replaced", async () => {
            await triggerWebhook(apiServer, subscriptionEvent({
                alert_name: 'subscription_payment_succeeded',
                status: 'active',
                next_bill_date: '2028-01-01',
                quantity: '1',
                receipt_url: 'https://receipt.example'
            }));

            expect(await getUserMetadata(userEmail)).to.deep.equal(LIFETIME_LICENSE);
        });

        it("ignores new subscriptions", async () => {
            await triggerWebhook(apiServer, subscriptionEvent({
                alert_name: 'subscription_created',
                status: 'active',
                next_bill_date: '2028-01-01',
                quantity: '1'
            }));

            expect(await getUserMetadata(userEmail)).to.deep.equal(LIFETIME_LICENSE);
        });
    });

    describe("after a license is revoked by hand", () => {

        it("lets the user subscribe again afterwards", async () => {
            await givenUser(userId, userEmail, {
                ...LIFETIME_LICENSE,
                subscription_status: 'deleted',
                subscription_expiry: Date.now() - 1000
            });

            await triggerWebhook(apiServer, {
                alert_name: 'subscription_created',
                status: 'active',
                email: userEmail,
                user_id: '123',
                subscription_id: '456',
                subscription_plan_id: '550382', // Pro-annual
                next_bill_date: '2030-01-01',
                quantity: '1'
            });

            expect(await getUserMetadata(userEmail)).to.deep.include({
                subscription_status: 'active',
                subscription_sku: 'pro-annual',
                subscription_id: '456'
            });
        });
    });
});
