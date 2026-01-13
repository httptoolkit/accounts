import * as net from 'net';
import { expect } from 'chai';

import jwt from 'jsonwebtoken';

import { DestroyableServer } from 'destroyable-server';
import { startAPI, privateKey, givenUser, givenAuthToken, givenRefreshToken } from './test-setup/setup.ts';
import { AUTH0_PORT, auth0Server, givenAuth0Token } from './test-setup/auth0.ts';
import { testDB } from './test-setup/database.ts';


const TOKEN_RESPONSE = {
    "access_token": "at",
    "refresh_token": "rt",
    "scope": "email offline_access",
    "expires_in": 86400,
    "token_type": "Bearer",
    "id_token": jwt.sign(
        JSON.stringify({
            "iss": `https://localhost:${AUTH0_PORT}/`,
            "aud": "auth-client-id",
            "exp": Date.now() + 86400,
            "iat": Date.now(),
            "email": "test-user@example.test",
            "sub": "auth0|userid"
        }),
        privateKey.toString(),
        { algorithm: 'RS256' }
    )
};

describe("API auth endpoints", () => {

    let apiServer: DestroyableServer;
    let apiAddress: string;

    beforeEach(async () => {
        apiServer = await startAPI();
        apiAddress = `http://localhost:${(apiServer.address() as net.AddressInfo).port}`;
    });

    afterEach(async () => {
        await apiServer.destroy();
    });

    describe("/auth/send-code", () => {

        it("returns a 400 if you don't provide a body", async () => {
            const pwStartEndpoint = await auth0Server.forPost('/passwordless/start').thenReply(200);

            const response = await fetch(`${apiAddress}/api/auth/send-code`, {
                method: 'POST'
            });

            expect(response.status).to.equal(400);
            expect(await pwStartEndpoint.getSeenRequests()).to.have.length(0);
        });

        it("returns a 400 if you don't provide an email or source", async () => {
            const pwStartEndpoint = await auth0Server.forPost('/passwordless/start').thenReply(200);

            const response = await fetch(`${apiAddress}/api/auth/send-code`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ })
            });

            expect(response.status).to.equal(400);
            expect(await pwStartEndpoint.getSeenRequests()).to.have.length(0);
        });

        it("sends a request to Auth0 to start passwordless auth", async () => {
            const email = 'test-user@example.test'

            const pwStartEndpoint = await auth0Server.forPost('/passwordless/start')
                .withJsonBodyIncluding({
                    connection: 'email',
                    email,
                    send: 'code'
                })
                .thenReply(200);

            const response = await fetch(`${apiAddress}/api/auth/send-code`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, source: 'test' })
            });

            expect(response.status).to.equal(200);
            expect(await pwStartEndpoint.getSeenRequests()).to.have.length(1);
        });

    });

    describe("/auth/login", () => {

        it("returns a 400 if you don't provide a body", async () => {
            const tokenEndpoint = await auth0Server.forPost('/oauth/token').thenJson(200, TOKEN_RESPONSE);

            const response = await fetch(`${apiAddress}/api/auth/login`, {
                method: 'POST'
            });

            expect(response.status).to.equal(400);
            expect(await tokenEndpoint.getSeenRequests()).to.have.length(0);
        });

        it("returns a 400 if you don't provide a code", async () => {
            const tokenEndpoint = await auth0Server.forPost('/oauth/token').thenReply(200);

            const response = await fetch(`${apiAddress}/api/auth/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'test@example.test' })
            });

            expect(response.status).to.equal(400);
            expect(await tokenEndpoint.getSeenRequests()).to.have.length(0);
        });

        it("sends a request to Auth0 to complete passwordless auth", async () => {
            const email = 'test-user@example.test';
            const code = '1234';

            const tokenEndpoint = await auth0Server.forPost('/oauth/token')
                .withForm({
                    username: email,
                    realm: 'email',
                    otp: code,
                    scope: 'email openid offline_access app_metadata',
                    grant_type: 'http://auth0.com/oauth/grant-type/passwordless/otp'
                })
                .thenJson(200, TOKEN_RESPONSE);

            const response = await fetch(`${apiAddress}/api/auth/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, code })
            });

            expect(response.status).to.equal(200);
            expect(await tokenEndpoint.getSeenRequests()).to.have.length(1);

            const result = await response.json();
            expect(result.accessToken).to.equal('at');
            expect(result.refreshToken).to.equal('rt');
            expect(result.expiresAt).to.be.greaterThan(Date.now());
            expect(result.expiresAt).to.be.lessThan(Date.now() + 100_000_000);

            // The tokens issued by Auth0 should be cached in the DB:
            const dbRefreshTokens = (await testDB.query('SELECT * FROM refresh_tokens')).rows;
            expect(dbRefreshTokens).to.have.length(1);
            expect(dbRefreshTokens[0].user_id).to.equal(1);
            expect(dbRefreshTokens[0].value).to.equal('rt');

            const dbAccessTokens = (await testDB.query('SELECT * FROM access_tokens')).rows;
            expect(dbAccessTokens).to.have.length(1);
            expect(dbAccessTokens[0].value).to.equal('at');
            expect(dbAccessTokens[0].refresh_token).to.equal('rt');
        });

    });

    describe("/auth/refresh-token", () => {

        it("returns a 400 if you don't provide a body", async () => {
            const tokenEndpoint = await auth0Server.forPost('/oauth/token').thenJson(200, TOKEN_RESPONSE);

            const response = await fetch(`${apiAddress}/api/auth/refresh-token`, {
                method: 'POST'
            });

            expect(response.status).to.equal(400);
            expect(await tokenEndpoint.getSeenRequests()).to.have.length(0);
        });

        it("returns a 400 if you don't provide a refreshToken", async () => {
            const tokenEndpoint = await auth0Server.forPost('/oauth/token').thenReply(200);

            const response = await fetch(`${apiAddress}/api/auth/refresh-token`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ })
            });

            expect(response.status).to.equal(400);
            expect(await tokenEndpoint.getSeenRequests()).to.have.length(0);
        });

        it("sends a request to Auth0 to refresh the token", async () => {
            await givenUser('auth0|userid', 'test-user@example.test');
            await givenAuth0Token(TOKEN_RESPONSE.access_token, 'auth0|userid', 'test-user@example.test');

            const refreshToken = 'rt';
            const tokenEndpoint = await auth0Server.forPost('/oauth/token')
                .withForm({
                    refresh_token: refreshToken,
                    grant_type: 'refresh_token'
                })
                .thenJson(200, TOKEN_RESPONSE);

            const response = await fetch(`${apiAddress}/api/auth/refresh-token`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });

            expect(response.status).to.equal(200);
            expect(await tokenEndpoint.getSeenRequests()).to.have.length(1);

            const result = await response.json();
            expect(result.accessToken).to.equal('at');
            expect(result.expiresAt).to.be.greaterThan(Date.now());
            expect(result.expiresAt).to.be.lessThan(Date.now() + 100_000_000);
        });

        it("caches the token in the DB, if not seen before", async () => {
            await givenUser('auth0|userid', 'test-user@example.test');

            const refreshToken = 'rt';
            const tokenEndpoint = await auth0Server.forPost('/oauth/token')
                .withForm({
                    refresh_token: refreshToken,
                    grant_type: 'refresh_token'
                })
                .thenJson(200, TOKEN_RESPONSE);

            await givenAuthToken(TOKEN_RESPONSE.access_token, 'auth0|userid', 'test-user@example.test');

            await testDB.query('DELETE FROM access_tokens');
            await testDB.query('DELETE FROM refresh_tokens');

            const response = await fetch(`${apiAddress}/api/auth/refresh-token`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });

            expect(response.status).to.equal(200);
            expect(await tokenEndpoint.getSeenRequests()).to.have.length(1);

            const result = await response.json();
            expect(result.accessToken).to.equal('at');
            expect(result.expiresAt).to.be.greaterThan(Date.now());
            expect(result.expiresAt).to.be.lessThan(Date.now() + 100_000_000);

            const users = (await testDB.query('SELECT * FROM users')).rows;
            expect(users).to.have.length(1);
            const user = users[0];

            // The tokens issued by Auth0 should be cached in the DB:
            const dbRefreshTokens = (await testDB.query('SELECT * FROM refresh_tokens')).rows;
            expect(dbRefreshTokens).to.have.length(1);
            expect(dbRefreshTokens[0].user_id).to.equal(user.id);
            expect(dbRefreshTokens[0].value).to.equal('rt');

            const dbAccessTokens = (await testDB.query('SELECT * FROM access_tokens')).rows;
            expect(dbAccessTokens).to.have.length(1);
            expect(dbAccessTokens[0].value).to.equal('at');
            expect(dbAccessTokens[0].refresh_token).to.equal('rt');
        });

        it("caches the user themselves and the token in the DB, if not seen before", async () => {
            await givenUser('auth0|userid', 'test-user@example.test');

            const refreshToken = 'rt';
            const tokenEndpoint = await auth0Server.forPost('/oauth/token')
                .withForm({
                    refresh_token: refreshToken,
                    grant_type: 'refresh_token'
                })
                .thenJson(200, TOKEN_RESPONSE);

            await givenAuthToken(TOKEN_RESPONSE.access_token, 'auth0|userid', 'test-user@example.test');

            await testDB.query('DELETE FROM access_tokens');
            await testDB.query('DELETE FROM refresh_tokens');
            await testDB.query('DELETE FROM users');

            const response = await fetch(`${apiAddress}/api/auth/refresh-token`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });

            expect(response.status).to.equal(200);
            expect(await tokenEndpoint.getSeenRequests()).to.have.length(1);

            const result = await response.json();
            expect(result.accessToken).to.equal('at');
            expect(result.expiresAt).to.be.greaterThan(Date.now());
            expect(result.expiresAt).to.be.lessThan(Date.now() + 100_000_000);

            // The user should have been implicitly created in the DB:
            const users = (await testDB.query('SELECT * FROM users')).rows;
            expect(users).to.have.length(1);
            const user = users[0];
            expect(user.auth0_user_id).to.equal('auth0|userid');
            expect(user.email).to.equal('test-user@example.test');

            // The tokens issued by Auth0 should be cached in the DB:
            const dbRefreshTokens = (await testDB.query('SELECT * FROM refresh_tokens')).rows;
            expect(dbRefreshTokens).to.have.length(1);
            expect(dbRefreshTokens[0].user_id).to.equal(user.id);
            expect(dbRefreshTokens[0].value).to.equal('rt');

            const dbAccessTokens = (await testDB.query('SELECT * FROM access_tokens')).rows;
            expect(dbAccessTokens).to.have.length(1);
            expect(dbAccessTokens[0].value).to.equal('at');
            expect(dbAccessTokens[0].refresh_token).to.equal('rt');
        });

        it("skips Auth0 entirely if the user is already in the DB", async () => {
            const refreshToken = 'rt';
            await givenUser('auth0|userid', 'test-user@example.test');
            await givenRefreshToken(refreshToken, 'auth0|userid');

            const tokenEndpoint = await auth0Server.forPost('/oauth/token')
                .withForm({
                    refresh_token: refreshToken,
                    grant_type: 'refresh_token'
                })
                .thenCallback(() => {
                    throw new Error('Should not be called');
                });

            const response = await fetch(`${apiAddress}/api/auth/refresh-token`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });

            expect(response.status).to.equal(200);
            expect(await tokenEndpoint.getSeenRequests()).to.have.length(0);

            const result = await response.json();
            expect(result.accessToken).to.match(/^at-.{64}$/);
            expect(result.expiresAt).to.be.greaterThan(Date.now());
            expect(result.expiresAt).to.be.lessThan(Date.now() + 100_000_000);

            // The resulting token should appear in the DB:
            const dbAccessTokens = (await testDB.query('SELECT * FROM access_tokens')).rows;
            expect(dbAccessTokens).to.have.length(1);
            expect(dbAccessTokens[0].value).to.equal(result.accessToken);
            expect(dbAccessTokens[0].refresh_token).to.equal(refreshToken);
        });
    });

});