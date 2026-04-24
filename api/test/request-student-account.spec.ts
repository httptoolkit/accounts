import * as net from 'net';
import { DestroyableServer } from 'destroyable-server';

import { expect } from 'chai';

import {
    startAPI,
    givenUser,
    freshAuthToken,
    givenAuthToken
} from './test-setup/setup.ts';
import { testDB } from './test-setup/database.ts';

const requestStudentAccount = (server: net.Server, authToken?: string) => fetch(
    `http://localhost:${(server.address() as net.AddressInfo).port}/api/request-student-account`,
    {
        method: 'POST',
        headers: authToken
            ? { Authorization: `Bearer ${authToken}` }
            : undefined
    }
);

describe('Request student account API', () => {

    let apiServer: DestroyableServer;

    beforeEach(async () => {
        apiServer = await startAPI();
    });

    afterEach(async () => {
        await apiServer.destroy();
    });

    it('grants a student account for an academic email', async () => {
        const authToken = freshAuthToken();
        const userId = 'student-user';
        const userEmail = 'student@stanford.edu';

        await givenUser(userId, userEmail, {});
        await givenAuthToken(authToken, userId);

        const response = await requestStudentAccount(apiServer, authToken);
        expect(response.status).to.equal(200);

        const body = await response.json();
        expect(body.success).to.equal(true);
        expect(body.school).to.equal('stanford.edu');
        expect(body.expiry).to.be.greaterThan(Date.now());

        const dbUser = await testDB.query(
            'SELECT app_metadata FROM users WHERE auth0_user_id = $1',
            [userId]
        );

        expect(dbUser.rows[0].app_metadata).to.include({
            subscription_status: 'trialing',
            payment_provider: 'student-account',
            subscription_sku: 'pro-annual',
            subscription_quantity: 1
        });
    });

    it('rejects non-academic emails', async () => {
        const authToken = freshAuthToken();
        const userId = 'non-student-user';
        const userEmail = 'user@gmail.com';

        await givenUser(userId, userEmail, {});
        await givenAuthToken(authToken, userId);

        const response = await requestStudentAccount(apiServer, authToken);
        expect(response.status).to.equal(403);

        const body = await response.json();
        expect(body.error).to.equal('not_academic');

        const dbUser = await testDB.query(
            'SELECT app_metadata FROM users WHERE auth0_user_id = $1',
            [userId]
        );

        expect(dbUser.rows[0].app_metadata).to.deep.equal({});
    });

    it('rejects existing student accounts', async () => {
        const authToken = freshAuthToken();
        const userId = 'paying-student-user';
        const userEmail = 'paying-student@stanford.edu';

        const initialData = {
            payment_provider: 'student-account',
            subscription_status: 'trialing',
            subscription_expiry: Date.now() + 1000 * 60 * 60 * 24 * 365, // 1 year in future
            subscription_sku: 'pro-annual'
        }

        await givenUser(userId, userEmail, initialData);
        await givenAuthToken(authToken, userId);

        const response = await requestStudentAccount(apiServer, authToken);
        expect(response.status).to.equal(409);

        const body = await response.json();
        expect(body.error).to.equal('already_active');
        expect(body.message).to.equal('You already have an active student subscription. You can renew when less than 2 months remain.');

        const dbUser = await testDB.query(
            'SELECT app_metadata FROM users WHERE auth0_user_id = $1',
            [userId]
        );

        expect(dbUser.rows[0].app_metadata).to.deep.equal(initialData);
    });

    it('rejects existing paying users', async () => {
        const authToken = freshAuthToken();
        const userId = 'paying-student-user';
        const userEmail = 'paying-student@stanford.edu';

        const initialData = {
            payment_provider: 'paddle',
            subscription_status: 'active'
        }
        await givenUser(userId, userEmail, initialData);
        await givenAuthToken(authToken, userId);

        const response = await requestStudentAccount(apiServer, authToken);
        expect(response.status).to.equal(409);

        const body = await response.json();
        expect(body.error).to.equal('paid_account');
        expect(body.message).to.equal('You have an active paid subscription. Please cancel your existing subscription first, and try again.');

        const dbUser = await testDB.query(
            'SELECT app_metadata FROM users WHERE auth0_user_id = $1',
            [userId]
        );

        expect(dbUser.rows[0].app_metadata).to.deep.equal(initialData);
    });
});
