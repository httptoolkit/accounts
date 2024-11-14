import * as net from 'net';
import { expect } from 'chai';

import { DestroyableServer } from "destroyable-server";
import { AUTH0_PORT, auth0Server, startServer } from "./test-util";

const TOKEN_RESPONSE = {
    "access_token": "at",
    "refresh_token": "rt",
    "scope": "email offline_access",
    "expires_in": 86400,
    "token_type": "Bearer"
};

describe("API auth endpoints", () => {

    let apiServer: DestroyableServer;
    let apiAddress: string;

    beforeEach(async () => {
        apiServer = await startServer();
        apiAddress = `http://localhost:${(apiServer.address() as net.AddressInfo).port}`;

        await auth0Server.start(AUTH0_PORT);
    });

    afterEach(async () => {
        await apiServer.destroy();
        await auth0Server.stop();
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
                    scope: 'email offline_access app_metadata',
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
    });

});