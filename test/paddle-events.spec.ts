import * as crypto from 'crypto';
import * as net from 'net';
import * as path from 'path';
import fetch, { Response } from 'node-fetch';
import moment from 'moment';

import { expect } from 'chai';
import { getLocal } from 'mockttp';
import stoppable from 'stoppable';

import { serveFunctions } from 'netlify-cli/src/utils/serve-functions';

function generateKeyPair() {
    return crypto.generateKeyPairSync('rsa', {
        modulusLength: 512,
        privateKeyEncoding: {
            type: "pkcs1",
            format: 'pem'
        } as any,
        publicKeyEncoding: {
            type: "spki",
            format: 'pem'
        }
    });
}

const { privateKey, publicKey } = generateKeyPair();
process.env.PADDLE_PUBLIC_KEY = publicKey.split('\n').slice(1, -2).join('\n');

import { serializeWebhookData, WebhookData, UnsignedWebhookData } from '../src/paddle';

const startServer = (port = 0) => {
    return serveFunctions({
        functionsDir: process.env.FUNCTIONS_DIR || path.join(__dirname, '..', 'functions'),
        quiet: true,
        watch: false,
        port
    });
};

const signBody = (body: UnsignedWebhookData) => {
    const serializedData = serializeWebhookData(body);
    const signer = crypto.createSign('sha1');
    signer.update(serializedData);
    signer.end();

    return signer.sign(privateKey, 'base64');
}

const getPaddleWebhookData = (unsignedBody: Partial<WebhookData>) => {
    const body = Object.assign({
        p_signature: signBody(unsignedBody as WebhookData)
    }, unsignedBody) as WebhookData;

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

const triggerWebhook = async (server: net.Server, unsignedBody: Partial<WebhookData>) => {
    const functionServerUrl = `http://localhost:${(server.address() as net.AddressInfo).port}`;

    const result = await fetch(
        `${functionServerUrl}/.netlify/functions/paddle-webhook`,
        getPaddleWebhookData(unsignedBody)
    );

    expect(result.status).to.equal(200);
}

const AUTH0_PORT = 9091;
process.env.AUTH0_DOMAIN = `localhost:${AUTH0_PORT}`;
process.env.AUTH0_APP_CLIENT_ID = 'auth0-id';
process.env.AUTH0_MGMT_CLIENT_ID = 'auth0-mgmt-id';
process.env.AUTH0_MGMT_CLIENT_SECRET = 'auth0-mgmt-secret';

const auth0Server = getLocal({
    https: {
        keyPath: path.join(__dirname, 'fixtures', 'test-ca.key'),
        certPath: path.join(__dirname, 'fixtures', 'test-ca.pem'),
    }
});

function givenUser(userId: number, email: string) {
    return auth0Server
        .get('/api/v2/users-by-email')
        .withQuery({ email })
        .thenReply(200, JSON.stringify([
            { email: email, user_id: userId }
        ]), {
            "content-type": 'application/json'
        });
}

describe('Paddle webhook', () => {

    let functionServer: stoppable.StoppableServer;

    beforeEach(async () => {
        functionServer = stoppable((await startServer()).server, 0);
        await auth0Server.start(AUTH0_PORT);
        await auth0Server.post('/oauth/token').thenReply(200);
    });
    afterEach(async () => {
        await new Promise((resolve) => functionServer.stop(resolve));
        await auth0Server.stop()
    });

    it('successfully handles new Pro subscriptions', async () => {
        const userId = 123;
        const userEmail = 'user@example.com';
        givenUser(userId, userEmail);

        const userUpdate = await auth0Server
            .patch('/api/v2/users/' + userId)
            .thenReply(200);

        const nextRenewal = moment('2025-01-01');

        await triggerWebhook(functionServer, {
            alert_name: 'subscription_created',
            status: 'active',
            email: userEmail,
            subscription_id: '456',
            subscription_plan_id: '550382', // Pro-annual
            next_bill_date: nextRenewal.format('YYYY-MM-DD')
        });

        const updateRequests = await userUpdate.getSeenRequests();
        expect(updateRequests.length).to.equal(1);
        expect(updateRequests[0].body.json).to.deep.equal({
            app_metadata: {
                subscription_status: 'active',
                subscription_id: 456,
                subscription_plan_id: 550382,
                subscription_expiry: nextRenewal.add(1, 'days').valueOf()
            }
        });
    });

    it('successfully renews Pro subscriptions', async () => {
        const userId = 123;
        const userEmail = 'user@example.com';
        givenUser(userId, userEmail);

        const userUpdate = await auth0Server
            .patch('/api/v2/users/' + userId)
            .thenReply(200);

        const nextRenewal = moment('2025-01-01');

        await triggerWebhook(functionServer, {
            alert_name: 'subscription_payment_succeeded',
            status: 'active',
            email: userEmail,
            subscription_id: '456',
            subscription_plan_id: '550382', // Pro-annual
            next_bill_date: nextRenewal.format('YYYY-MM-DD')
        });

        const updateRequests = await userUpdate.getSeenRequests();
        expect(updateRequests.length).to.equal(1);
        expect(updateRequests[0].body.json).to.deep.equal({
            app_metadata: {
                subscription_status: 'active',
                subscription_id: 456,
                subscription_plan_id: 550382,
                subscription_expiry: nextRenewal.add(1, 'days').valueOf()
            }
        });
    });

    it('successfully cancels Pro subscriptions on request', async () => {
        const userId = 123;
        const userEmail = 'user@example.com';
        givenUser(userId, userEmail);

        const userUpdate = await auth0Server
            .patch('/api/v2/users/' + userId)
            .thenReply(200);

        const cancellationDate = moment('2025-01-01');

        await triggerWebhook(functionServer, {
            alert_name: 'subscription_cancelled',
            email: userEmail,
            subscription_id: '456',
            subscription_plan_id: '550382', // Pro-annual
            cancellation_effective_date: cancellationDate.format('YYYY-MM-DD')
        });

        const updateRequests = await userUpdate.getSeenRequests();
        expect(updateRequests.length).to.equal(1);
        expect(updateRequests[0].body.json).to.deep.equal({
            app_metadata: {
                subscription_status: 'deleted',
                subscription_id: 456,
                subscription_plan_id: 550382,
                subscription_expiry: cancellationDate.valueOf()
            }
        });
    });

    it('successfully cancels Pro subscriptions after failed payments', async () => {
        const userId = 123;
        const userEmail = 'user@example.com';
        givenUser(userId, userEmail);

        const userUpdate = await auth0Server
            .patch('/api/v2/users/' + userId)
            .thenReply(200);

        const currentDate = moment('2020-01-01');
        const finalDate = moment('2020-01-07');

        // Initial renewal failure:

        await triggerWebhook(functionServer, {
            alert_name: 'subscription_updated',
            status: 'past_due',
            email: userEmail,
            subscription_id: '456',
            subscription_plan_id: '550382', // Pro-annual
            next_bill_date: currentDate.format('YYYY-MM-DD')
        })

        await triggerWebhook(functionServer, {
            alert_name: 'subscription_payment_failed',
            status: 'past_due',
            email: userEmail,
            subscription_id: '456',
            subscription_plan_id: '550382', // Pro-annual
            next_retry_date: finalDate.format('YYYY-MM-DD')
        });

        let updateRequests = await userUpdate.getSeenRequests();
        expect(updateRequests.length).to.equal(2);
        expect(updateRequests[0].body.json).to.deep.equal({
            app_metadata: {
                subscription_status: 'past_due',
                subscription_id: 456,
                subscription_plan_id: 550382,
                subscription_expiry: currentDate.add(1, 'days').valueOf()
            }
        });
        expect(updateRequests[1].body.json).to.deep.equal({
            app_metadata: {
                subscription_status: 'past_due',
                subscription_id: 456,
                subscription_plan_id: 550382,
                subscription_expiry: finalDate.add(1, 'days').valueOf()
            }
        });

        // Final renewal failure:

        await triggerWebhook(functionServer, {
            alert_name: 'subscription_payment_failed',
            status: 'past_due',
            email: userEmail,
            subscription_id: '456',
            subscription_plan_id: '550382', // Pro-annual
            // N.B: no next_retry_date, we're done
        });

        await triggerWebhook(functionServer, {
            alert_name: 'subscription_cancelled',
            email: userEmail,
            subscription_id: '456',
            subscription_plan_id: '550382', // Pro-annual
            cancellation_effective_date: finalDate.format('YYYY-MM-DD')
        });

        updateRequests = await userUpdate.getSeenRequests();
        expect(updateRequests.length).to.equal(4);
        expect(updateRequests[2].body.json).to.deep.equal({
            app_metadata: {
                subscription_status: 'deleted',
                subscription_id: 456,
                subscription_plan_id: 550382
            }
        });
        expect(updateRequests[3].body.json).to.deep.equal({
            app_metadata: {
                subscription_status: 'deleted',
                subscription_id: 456,
                subscription_plan_id: 550382,
                subscription_expiry: finalDate.valueOf()
            }
        });
    });
});