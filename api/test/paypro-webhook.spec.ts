import * as _ from 'lodash';
import * as crypto from 'crypto';
import * as net from 'net';
import fetch from 'node-fetch';
import moment, { Moment } from 'moment';
import { DestroyableServer } from 'destroyable-server';

import { expect } from 'chai';

import {
    startAPI,
    givenUser,
    givenNoUsers,
    PAYPRO_IPN_VALIDATION_KEY
} from './test-setup/setup';
import { profitwellApiServer } from './test-setup/profitwell';
import { auth0Server } from './test-setup/auth0';

import {
    PayProOrderDateFormat,
    PayProRenewalDateFormat,
    PayProWebhookData
} from '../src/paypro';

// Validated by testing with the real key and signatures from real IPN
// requests - this generates the correct matching signature.
const getSignature = (body: Partial<PayProWebhookData>) => {
    const key = [
        body.ORDER_ID,
        body.ORDER_STATUS,
        body.ORDER_TOTAL_AMOUNT,
        body.CUSTOMER_EMAIL,
        PAYPRO_IPN_VALIDATION_KEY,
        body.TEST_MODE,
        body.IPN_TYPE_NAME
    ].join('');

    return crypto.createHash('sha256')
        .update(key)
        .digest('hex');
}

const getPayProWebhookData = (unsignedBody: Partial<PayProWebhookData>) => {
    const body = {
        SIGNATURE: getSignature(unsignedBody),
        ...unsignedBody
    } as PayProWebhookData;

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
    unsignedBody: Partial<PayProWebhookData>,
    options: { expectedStatus: number } = { expectedStatus: 200 }
) => {
    const apiServerUrl = `http://localhost:${(server.address() as net.AddressInfo).port}`;

    const result = await fetch(
        `${apiServerUrl}/api/paypro-webhook`,
        getPayProWebhookData(unsignedBody)
    );

    expect(result.status).to.equal(options.expectedStatus);
}

function formatOrderDate(date: Moment) {
    return date.utc().format(PayProOrderDateFormat);
}

// Yes these two dates are different, and yes this one is especially nuts
function formatRenewalDate(date: Moment) {
    return date.utc().format(PayProRenewalDateFormat);
}

describe('PayPro webhooks', () => {

    let apiServer: DestroyableServer;

    beforeEach(async () => {
        apiServer = await startAPI();
    });

    afterEach(async () => {
        await apiServer.destroy();
    });

    it('should reject invalid webhooks', async () => {
        const auth0ApiMock = await auth0Server
            .forAnyRequest()
            .always()
            .asPriority(100)
            .thenReply(200);

        await triggerWebhook(apiServer, {
            IPN_TYPE_NAME: 'OrderCharged',
            ORDER_ITEM_SKU: 'pro-monthly',
            CUSTOMER_ID: '123',
            SUBSCRIPTION_ID: '456',
            SUBSCRIPTION_RENEWAL_TYPE: 'Auto',
            SUBSCRIPTION_NEXT_CHARGE_DATE: formatRenewalDate(moment('2030-01-01')),
            INVOICE_LINK: "https://store.payproglobal.com/Invoice?Id=MY_UUID",
            PRODUCT_QUANTITY: '1',
            TEST_MODE: '0',
            CUSTOMER_EMAIL: 'test@email.com',

            SIGNATURE: 'BAD-SIGNATURE'
        }, {
            // Should loudly fail:
            expectedStatus: 403
        });

        // Should not do anything with user data:
        const authRequests = await auth0ApiMock.getSeenRequests();
        expect(authRequests.length).to.equal(0);
    });

    describe("for Pro subscriptions", () => {

        it('successfully handle new subscriptions for a new user', async () => {
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
                .thenJson(200, {});

            const nextRenewal = moment('2030-01-01');

            await triggerWebhook(apiServer, {
                IPN_TYPE_NAME: 'OrderCharged',
                ORDER_ITEM_SKU: 'pro-monthly',
                CUSTOMER_ID: '123',
                SUBSCRIPTION_ID: '456',
                SUBSCRIPTION_STATUS_NAME: 'Active',
                SUBSCRIPTION_RENEWAL_TYPE: 'Auto',
                SUBSCRIPTION_NEXT_CHARGE_DATE: formatRenewalDate(nextRenewal),
                ORDER_PLACED_TIME_UTC: formatOrderDate(moment()),
                INVOICE_LINK: "https://store.payproglobal.com/Invoice?Id=MY_UUID",
                PRODUCT_QUANTITY: '1',
                TEST_MODE: '0',
                CUSTOMER_EMAIL: userEmail
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
                    payment_provider: 'paypro',
                    subscription_id: '456',
                    subscription_sku: 'pro-monthly',
                    subscription_quantity: 1,
                    subscription_expiry: nextRenewal.valueOf(),
                    last_receipt_url: "https://store.payproglobal.com/Invoice?Id=MY_UUID"
                }
            });
        });

        it('successfully handle new subscriptions for an existing user', async () => {
            const userId = "abc";
            const userEmail = 'user@example.com';
            givenUser(userId, userEmail);

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenJson(200, {});

            const nextRenewal = moment('2030-01-01');

            await triggerWebhook(apiServer, {
                IPN_TYPE_NAME: 'OrderCharged',
                ORDER_ITEM_SKU: 'pro-monthly',
                CUSTOMER_ID: '123',
                SUBSCRIPTION_ID: '456',
                SUBSCRIPTION_STATUS_NAME: 'Active',
                SUBSCRIPTION_RENEWAL_TYPE: 'Auto',
                SUBSCRIPTION_NEXT_CHARGE_DATE: formatRenewalDate(nextRenewal),
                ORDER_PLACED_TIME_UTC: formatOrderDate(moment()),
                INVOICE_LINK: "https://store.payproglobal.com/Invoice?Id=MY_UUID",
                PRODUCT_QUANTITY: '1',
                TEST_MODE: '0',
                CUSTOMER_EMAIL: userEmail
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'active',
                    payment_provider: 'paypro',
                    subscription_id: '456',
                    subscription_sku: 'pro-monthly',
                    subscription_quantity: 1,
                    subscription_expiry: nextRenewal.valueOf(),
                    last_receipt_url: "https://store.payproglobal.com/Invoice?Id=MY_UUID"
                }
            });
        });

        it('should successfully renew subscriptions', async () => {
            const userId = "abc";
            const userEmail = 'user@example.com';
            const nextRenewal = moment('2030-01-01');

            givenUser(userId, userEmail, {
                subscription_status: 'active',
                subscription_sku: 'pro-annual',
                subscription_expiry: nextRenewal.clone().subtract(30, 'days').valueOf()
            });

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenJson(200, {});

            await triggerWebhook(apiServer, {
                IPN_TYPE_NAME: 'SubscriptionChargeSucceed',
                ORDER_ITEM_SKU: 'pro-annual',
                SUBSCRIPTION_ID: '456',
                SUBSCRIPTION_RENEWAL_TYPE: 'Auto',
                SUBSCRIPTION_STATUS_NAME: 'Active',
                SUBSCRIPTION_NEXT_CHARGE_DATE: formatRenewalDate(nextRenewal),
                PRODUCT_QUANTITY: '1',
                TEST_MODE: '0',
                CUSTOMER_EMAIL: userEmail
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'active',
                    payment_provider: 'paypro',
                    subscription_id: '456',
                    subscription_sku: 'pro-annual',
                    subscription_quantity: 1,
                    subscription_expiry: nextRenewal.valueOf()
                }
            });
        });

        it('should cancel terminated subscriptions', async () => {
            const userId = "abc";
            const userEmail = 'user@example.com';
            const nextRenewal = moment('2030-01-01');

            givenUser(userId, userEmail, {
                subscription_status: 'active',
                subscription_sku: 'pro-annual',
                subscription_expiry: nextRenewal.clone().subtract(30, 'days').valueOf()
            });

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenJson(200, {});

            await triggerWebhook(apiServer, {
                IPN_TYPE_NAME: 'SubscriptionTerminated',
                ORDER_ITEM_SKU: 'pro-annual',
                SUBSCRIPTION_ID: '456',
                SUBSCRIPTION_RENEWAL_TYPE: 'Auto',
                SUBSCRIPTION_STATUS_NAME: 'Terminated',
                SUBSCRIPTION_NEXT_CHARGE_DATE: "",
                PRODUCT_QUANTITY: '1',
                TEST_MODE: '0',
                CUSTOMER_EMAIL: userEmail
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'deleted',
                    payment_provider: 'paypro',
                    subscription_id: '456',
                    subscription_sku: 'pro-annual',
                    subscription_quantity: 1
                    // Expiry is left unmodified - it should be the existing renewal date.
                }
            });
        });

        it('should cancel suspended subscriptions', async () => {
            const userId = "abc";
            const userEmail = 'user@example.com';
            const nextRenewal = moment('2030-01-01');

            givenUser(userId, userEmail, {
                subscription_status: 'active',
                subscription_sku: 'pro-annual',
                subscription_expiry: nextRenewal.clone().subtract(30, 'days').valueOf()
            });

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenJson(200, {});

            await triggerWebhook(apiServer, {
                IPN_TYPE_NAME: 'SubscriptionSuspended',
                ORDER_ITEM_SKU: 'pro-annual',
                SUBSCRIPTION_ID: '456',
                SUBSCRIPTION_RENEWAL_TYPE: 'Auto',
                SUBSCRIPTION_STATUS_NAME: 'Suspended',
                SUBSCRIPTION_NEXT_CHARGE_DATE: "",
                PRODUCT_QUANTITY: '1',
                TEST_MODE: '0',
                CUSTOMER_EMAIL: userEmail
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'deleted',
                    payment_provider: 'paypro',
                    subscription_id: '456',
                    subscription_sku: 'pro-annual',
                    subscription_quantity: 1
                    // Expiry is left unmodified - it should be the existing renewal date.
                }
            });
        });

        it('should handle users whose renewal payments fail', async () => {
            const userId = "abc";
            const userEmail = 'user@example.com';
            const nextRenewal = moment('2030-01-01');

            givenUser(userId, userEmail, {
                subscription_status: 'active',
                subscription_sku: 'pro-annual',
                subscription_expiry: nextRenewal.clone().subtract(30, 'days').valueOf()
            });

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenJson(200, {});

            await triggerWebhook(apiServer, {
                IPN_TYPE_NAME: 'SubscriptionChargeFailed',
                ORDER_ITEM_SKU: 'pro-annual',
                SUBSCRIPTION_ID: '456',
                SUBSCRIPTION_RENEWAL_TYPE: 'Auto',
                SUBSCRIPTION_STATUS_NAME: 'Active',
                SUBSCRIPTION_NEXT_CHARGE_DATE: formatRenewalDate(nextRenewal),
                PRODUCT_QUANTITY: '1',
                TEST_MODE: '0',
                CUSTOMER_EMAIL: userEmail
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            expect(await updateRequests[0].body.getJson()).to.deep.equal({
                app_metadata: {
                    subscription_status: 'past_due',
                    payment_provider: 'paypro',
                    subscription_id: '456',
                    subscription_sku: 'pro-annual',
                    subscription_quantity: 1,
                    subscription_expiry: nextRenewal.valueOf() // Expiry is next charge date
                }
            });
        });

        it('should log subscriptions in Profitwell', async () => {
            const userId = "abc";
            const userEmail = 'profitwell-test-user@example.com';
            givenUser(userId, userEmail);

            await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenJson(200, {});

            const subscriptionId = '456';

            const profitwellSubscriptionCreation = await profitwellApiServer
                .forPost('/v2/subscriptions/')
                .thenReply(200);

            const profitwellSubscriptionTraits = await profitwellApiServer
                .forPut('/v2/customer_traits/trait/')
                .withJsonBodyIncluding({ email: userEmail })
                .thenReply(200);

            const profitwellSubscriptionDeletion = await profitwellApiServer
                .forDelete(`/v2/subscriptions/${subscriptionId}`)
                .thenReply(200);

            const subscriptionCreation = moment.utc('2020-01-01');
            const nextRenewal = moment.utc('2030-01-01');

            await triggerWebhook(apiServer, {
                IPN_TYPE_NAME: 'OrderCharged',
                ORDER_ITEM_SKU: 'pro-monthly',
                CUSTOMER_ID: '123',
                SUBSCRIPTION_ID: subscriptionId,
                SUBSCRIPTION_STATUS_NAME: 'Active',
                SUBSCRIPTION_RENEWAL_TYPE: 'Auto',
                SUBSCRIPTION_NEXT_CHARGE_DATE: formatRenewalDate(nextRenewal),
                ORDER_PLACED_TIME_UTC: formatOrderDate(subscriptionCreation),
                INVOICE_LINK: "https://store.payproglobal.com/Invoice?Id=MY_UUID",
                PRODUCT_QUANTITY: '1',
                ORDER_CURRENCY_CODE: 'EUR',
                ORDER_ITEM_TOTAL_AMOUNT: '10',
                TEST_MODE: '0',
                CUSTOMER_EMAIL: userEmail,
                ORDER_CUSTOM_FIELDS: 'x-passthrough={"country":"ABC"}'
            });

            await givenUser(userId, userEmail, {
                subscription_expiry: nextRenewal.valueOf()
            });

            await triggerWebhook(apiServer, {
                IPN_TYPE_NAME: 'SubscriptionTerminated',
                ORDER_ITEM_SKU: 'pro-annual',
                SUBSCRIPTION_ID: '456',
                SUBSCRIPTION_RENEWAL_TYPE: 'Auto',
                SUBSCRIPTION_STATUS_NAME: 'Terminated',
                SUBSCRIPTION_NEXT_CHARGE_DATE: "",
                PRODUCT_QUANTITY: '1',
                TEST_MODE: '0',
                CUSTOMER_EMAIL: userEmail,
                ORDER_CUSTOM_FIELDS: 'x-passthrough={"country":"ABC"}'
            });

            const creationRequests = await profitwellSubscriptionCreation.getSeenRequests();
            expect(creationRequests.length).to.equal(1);
            expect(await creationRequests[0].body.getJson()).to.deep.equal({
                email: userEmail,
                user_alias: userEmail,
                subscription_alias: subscriptionId,
                plan_id: 550380, // Paddle's id for pro-monthly (used for data consistency)
                plan_interval: 'month',
                plan_currency: 'eur',
                value: 1000, // €10 in cents
                effective_date: Math.round(subscriptionCreation.valueOf() / 1000)
            });

            const customerTraitRequests = await profitwellSubscriptionTraits.getSeenRequests();
            expect(customerTraitRequests.length).to.equal(2);
            expect(
                await Promise.all(customerTraitRequests.map(async (r) => await r.body.getJson()))
            ).to.deep.equal([
                { email: userEmail, category: 'Payment provider', trait: 'paypro' },
                { email: userEmail, category: 'Country code', trait: 'ABC' }
            ]);

            const deletionRequests = await profitwellSubscriptionDeletion.getSeenRequests();
            expect(deletionRequests.length).to.equal(1);
            const deletionParams = new URL(deletionRequests[0].url).searchParams;
            expect([...deletionParams.entries()]).to.deep.equal([
                ['effective_date', (nextRenewal.valueOf() / 1000).toString()]
            ]);
        });

    });

    describe("for disputed payments", () => {

        it("should ban the user until they contact support", async () => {
            const userId = "abc";
            const userEmail = 'user@example.com';
            givenUser(userId, userEmail);

            const userUpdate = await auth0Server
                .forPatch('/api/v2/users/' + userId)
                .thenJson(200, {});

            await triggerWebhook(apiServer, {
                IPN_TYPE_NAME: 'OrderChargedBack',
                CUSTOMER_EMAIL: userEmail
            });

            const updateRequests = await userUpdate.getSeenRequests();
            expect(updateRequests.length).to.equal(1);
            const metadataUpdate = (await updateRequests[0].body.getJson() as any).app_metadata;
            expect(_.omit(metadataUpdate, 'subscription_expiry')).to.deep.equal({
                subscription_status: 'deleted',
                banned: true
            });
            expect(metadataUpdate.subscription_expiry).to.be.greaterThan(0);
        });

    });
});