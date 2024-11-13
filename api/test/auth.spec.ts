import * as net from 'net';

import { DestroyableServer } from "destroyable-server";
import { AUTH0_PORT, auth0Server, startServer } from "./test-util";
import { expect } from 'chai';

describe("API auth endpoints", () => {

    let apiServer: DestroyableServer;
    let apiAddress: string;

    beforeEach(async () => {
        apiServer = await startServer();
        apiAddress = `http://localhost:${(apiServer.address() as net.AddressInfo).port}`;

        await auth0Server.start(AUTH0_PORT);
        await auth0Server.forPost('/oauth/token').thenJson(200, {});
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

        it("returns a 400 if you don't provide an email", async () => {
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
                body: JSON.stringify({ email })
            });

            expect(response.status).to.equal(200);
            expect(await pwStartEndpoint.getSeenRequests()).to.have.length(1);
        });

    });
    
});