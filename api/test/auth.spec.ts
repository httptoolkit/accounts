import * as net from 'net';
import { expect } from 'chai';

import jwt from 'jsonwebtoken';

import { DestroyableServer } from 'destroyable-server';
import { startAPI, privateKey, givenUser, givenAuthToken, givenRefreshToken } from './test-setup/setup.ts';
import { AUTH0_PORT, auth0Server, givenAuth0Token, givenNoAuth0User, watchAuth0UserCreation } from './test-setup/auth0.ts';
import { testDB } from './test-setup/database.ts';
import { getReceivedEmails, getEmail } from './test-setup/smtp.ts';


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
            expect(await getReceivedEmails()).to.have.length(0);
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
            expect(await getReceivedEmails()).to.have.length(0);
        });

        it("sends a code to start passwordless auth, doesn't talk to Auth0", async () => {
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

            // Send an email with the code:
            const emails = await getReceivedEmails();
            expect(emails).to.have.length(1);
            expect(emails[0].Snippet).to.match(/^Your login code is: \d{6}/);
            const code = emails[0].Snippet.match(/\d{6}/)![0];

            const emailDetails = await getEmail(emails[0].ID);
            expect(emailDetails.To[0].Address).to.equal(email);
            expect(emailDetails.From).to.deep.equal({
                Name: 'HTTP Toolkit',
                Address: 'login@httptoolkit.com'
            });
            expect(emailDetails.Subject).to.equal('Welcome to HTTP Toolkit');
            expect(emailDetails.Text).to.equal(`Your HTTP Toolkit login code is: ${code}`);
            expect(emailDetails.HTML).to.include('Your login code is:');
            expect(emailDetails.HTML).to.include(code);

            // Auth0 shouldn't be used for auth any more:
            expect(await pwStartEndpoint.getSeenRequests()).to.have.length(0);
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

        it("accepts a valid first-login code request", async () => {
            const email = 'test-user@example.test';
            const code = '123456';

            await givenNoAuth0User(email);
            const getNewUsers = await watchAuth0UserCreation();

            await testDB.query(`
                INSERT INTO login_tokens (value, email, user_ip, expires_at)
                VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')
            `, [code, email, '1.2.3.4']);

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

            // Successfully issues tokens:
            const result = await response.json();
            expect(result.accessToken).to.match(/at-.*/);
            expect(result.refreshToken).to.match(/rt-.*/);
            expect(result.expiresAt).to.be.greaterThan(Date.now());
            expect(result.expiresAt).to.be.lessThan(Date.now() + 100_000_000);

            // Auth0 shouldn't be used for auth any more:
            expect(await tokenEndpoint.getSeenRequests()).to.have.length(0);

            // We do mirror new user creation there though (for now):
            const newAuth0Users = await getNewUsers();
            expect(newAuth0Users.length).to.equal(1);
            expect(newAuth0Users[0].url).to.equal('/api/v2/users');
            expect(newAuth0Users[0].body.email).to.equal(email);
            expect(newAuth0Users[0].body.email_verified).to.equal(true);

            // The issued tokens & user should be in the DB:
            const dbUsers = (await testDB.query('SELECT * FROM users')).rows;
            expect(dbUsers).to.have.length(1);
            expect(dbUsers[0].email).to.equal(email);
            expect(dbUsers[0].auth0_user_id).to.equal(newAuth0Users[0].id);

            const dbRefreshTokens = (await testDB.query('SELECT * FROM refresh_tokens')).rows;
            expect(dbRefreshTokens).to.have.length(1);
            expect(dbRefreshTokens[0].user_id).to.equal(1);
            expect(dbRefreshTokens[0].value).to.equal(result.refreshToken)

            const dbAccessTokens = (await testDB.query('SELECT * FROM access_tokens')).rows;
            expect(dbAccessTokens).to.have.length(1);
            expect(dbAccessTokens[0].value).to.equal(result.accessToken);
            expect(dbAccessTokens[0].refresh_token).to.equal(result.refreshToken);

            // The login token should be deleted:
            const dbLoginTokens = (await testDB.query('SELECT * FROM login_tokens')).rows;
            expect(dbLoginTokens).to.have.length(0);
        });

        it("accepts a valid returning-login code request, without creating a new user", async () => {
            const auth0UserId = 'auth0|existinguserid';
            const email = 'test-user@example.test';
            const code = '123456';

            await givenUser(auth0UserId, email);
            const getNewUsers = await watchAuth0UserCreation();

            await testDB.query(`
                INSERT INTO login_tokens (value, email, user_ip, expires_at)
                VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')
            `, [code, email, '1.2.3.4']);

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

            // Successfully issues tokens:
            const result = await response.json();
            expect(result.accessToken).to.match(/at-.*/);
            expect(result.refreshToken).to.match(/rt-.*/);
            expect(result.expiresAt).to.be.greaterThan(Date.now());
            expect(result.expiresAt).to.be.lessThan(Date.now() + 100_000_000);

            // Auth0 shouldn't be used at all:
            expect(await tokenEndpoint.getSeenRequests()).to.have.length(0);
            const newAuth0Users = await getNewUsers();
            expect(newAuth0Users.length).to.equal(0);

            // The issued tokens & user should be in the DB:
            const dbUsers = (await testDB.query('SELECT * FROM users')).rows;
            expect(dbUsers).to.have.length(1);
            expect(dbUsers[0].email).to.equal(email);
            expect(dbUsers[0].auth0_user_id).to.equal(auth0UserId);

            const dbRefreshTokens = (await testDB.query('SELECT * FROM refresh_tokens')).rows;
            expect(dbRefreshTokens).to.have.length(1);
            expect(dbRefreshTokens[0].user_id).to.equal(dbUsers[0].id);
            expect(dbRefreshTokens[0].value).to.equal(result.refreshToken)

            const dbAccessTokens = (await testDB.query('SELECT * FROM access_tokens')).rows;
            expect(dbAccessTokens).to.have.length(1);
            expect(dbAccessTokens[0].value).to.equal(result.accessToken);
            expect(dbAccessTokens[0].refresh_token).to.equal(result.refreshToken);

            // The login token should be deleted:
            const dbLoginTokens = (await testDB.query('SELECT * FROM login_tokens')).rows;
            expect(dbLoginTokens).to.have.length(0);
        });

        it("rejects wrong codes for login and tracks the attempt", async () => {
            const email = 'test-user@example.test';
            const code = '123456';

            await testDB.query(`
                INSERT INTO login_tokens (value, email, user_ip, expires_at)
                VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')
            `, [code, email, '1.2.3.4']);

            const response = await fetch(`${apiAddress}/api/auth/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, code: "654321" }) // Wrong code!
            });

            expect(response.status).to.equal(403);

            const loginTokens = (await testDB.query('SELECT * FROM login_tokens')).rows;
            expect(loginTokens).to.have.length(1);
            expect(loginTokens[0].attempts).to.equal(1);

            const dbUsers = (await testDB.query('SELECT * FROM users')).rows;
            expect(dbUsers).to.have.length(0);
        });

        it("blocks all login codes after 5 attempts", async () => {
            const email = 'test-user@example.test';
            const code1 = '123456';
            const code2 = '000000';

            await testDB.query(`
                INSERT INTO login_tokens (value, email, user_ip, expires_at)
                VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')
            `, [code1, email, '1.2.3.4']);

            await testDB.query(`
                INSERT INTO login_tokens (value, email, user_ip, expires_at)
                VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')
            `, [code2, email, '1.2.3.4']);

            const sendCode = async (code: string) => {
                const response = (await fetch(`${apiAddress}/api/auth/login`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ email, code })
                }));
                return response.status;
            };

            // Test the wrong code 5 times:
            for (let i = 0; i < 5; i++) {
                expect(await sendCode("654321")).to.equal(403);
            }

            // Invalid codes get a 429 now:
            expect(await sendCode("654321")).to.equal(429);

            // Both valid codes are now unusable:
            expect(await sendCode("123456")).to.equal(429);
            expect(await sendCode("000000")).to.equal(429);

            // Both login tokens now show 8 attempts:
            const loginTokens = (await testDB.query('SELECT * FROM login_tokens')).rows;
            expect(loginTokens).to.have.length(2);
            expect(loginTokens[0].attempts).to.equal(8);
            expect(loginTokens[1].attempts).to.equal(8);

            const dbUsers = (await testDB.query('SELECT * FROM users')).rows;
            expect(dbUsers).to.have.length(0);
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

    describe("Full auth lifecycle", () => {

        it("should work for a new user", async () => {
            const email = 'new-user@lifecycle.test';
            await givenNoAuth0User(email);

            const getNewAuth0Users = await watchAuth0UserCreation();

            const sendCodeResponse = await fetch(`${apiAddress}/api/auth/send-code`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, source: 'test' })
            });
            expect(sendCodeResponse.status).to.equal(200);

            const emails = await getReceivedEmails();
            expect(emails).to.have.length(1);
            const code = emails[0].Snippet.match(/\d{6}/)![0];

            const loginResponse = await fetch(`${apiAddress}/api/auth/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, code })
            });
            expect(loginResponse.status).to.equal(200);

            const loginResult = await loginResponse.json();
            const originalAccessToken = loginResult.accessToken;
            const originalRefreshToken = loginResult.refreshToken;

            const refreshResponse = await fetch(`${apiAddress}/api/auth/refresh-token`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ refreshToken: originalRefreshToken })
            });
            expect(refreshResponse.status).to.equal(200);

            const refreshResult = await refreshResponse.json();
            expect(refreshResult.accessToken).to.match(/^at-.*/);
            expect(refreshResult.accessToken).to.not.equal(originalAccessToken);

            // User should have been created in the DB:
            const dbUsers = (await testDB.query('SELECT * FROM users')).rows;
            expect(dbUsers).to.have.length(1);
            expect(dbUsers[0].email).to.equal(email);

            // User should have been created in Auth0:
            const newAuth0Users = await getNewAuth0Users();
            expect(newAuth0Users.length).to.equal(1);
            expect(newAuth0Users[0].body.email).to.equal(email);
            expect(dbUsers[0].auth0_user_id).to.equal(newAuth0Users[0].id);

            // Access tokens should be valid in DB
            const dbAccessTokens = (await testDB.query('SELECT * FROM access_tokens')).rows;
            expect(dbAccessTokens).to.have.length(2);
            expect(dbAccessTokens.map(t => t.value)).to.deep.equal([originalAccessToken, refreshResult.accessToken]);
        });

        it("should work for an existing user", async () => {
            const email = 'existing-user@lifecycle.test';
            const auth0UserId = 'auth0|existing-lifecycle';
            await givenUser(auth0UserId, email);

            const getNewAuth0Users = await watchAuth0UserCreation();

            const sendCodeResponse = await fetch(`${apiAddress}/api/auth/send-code`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, source: 'test' })
            });
            expect(sendCodeResponse.status).to.equal(200);

            const emails = await getReceivedEmails();
            expect(emails).to.have.length(1);
            const code = emails[0].Snippet.match(/\d{6}/)![0];

            const loginResponse = await fetch(`${apiAddress}/api/auth/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, code })
            });
            expect(loginResponse.status).to.equal(200);

            const loginResult = await loginResponse.json();
            const originalAccessToken = loginResult.accessToken;
            const originalRefreshToken = loginResult.refreshToken;

            const refreshResponse = await fetch(`${apiAddress}/api/auth/refresh-token`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ refreshToken: originalRefreshToken })
            });
            expect(refreshResponse.status).to.equal(200);

            const refreshResult = await refreshResponse.json();
            expect(refreshResult.accessToken).to.match(/^at-.*/);
            expect(refreshResult.accessToken).to.not.equal(originalAccessToken);

            // No new users in the DB - just the one
            const dbUsers = (await testDB.query('SELECT * FROM users')).rows;
            expect(dbUsers).to.have.length(1);
            expect(dbUsers[0].email).to.equal(email);

            // No new users in Auth0:
            const newAuth0Users = await getNewAuth0Users();
            expect(newAuth0Users.length).to.equal(0);

            // Access tokens should be valid in DB
            const dbAccessTokens = (await testDB.query('SELECT * FROM access_tokens')).rows;
            expect(dbAccessTokens).to.have.length(2);
            expect(dbAccessTokens.map(t => t.value)).to.deep.equal([originalAccessToken, refreshResult.accessToken]);
        });

    });

});