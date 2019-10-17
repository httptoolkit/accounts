import * as net from 'net';
import fetch from 'node-fetch';
import * as jwt from 'jsonwebtoken';

import { expect } from 'chai';

import {
    startServer,
    publicKey,
    auth0Server,
    AUTH0_PORT,
    givenUser,
    givenNoUsers
} from './test-util';
import stoppable from 'stoppable';

const getAppData = (server: net.Server, authToken?: string) => fetch(
    `http://localhost:${(server.address() as net.AddressInfo).port}/get-app-data`,
    {
        headers: authToken
            ? { Authorization: `Bearer ${authToken}` }
            : undefined
    }
);

const getJwtData = (jwtString: string): any => {
    const decoded: any = jwt.verify(jwtString, publicKey, {
        algorithms: ['RS256'],
        audience: 'https://httptoolkit.tech/app_data',
        issuer: 'https://httptoolkit.tech/'
    });

    // Remove the JWT metadata properties, for easier validation later
    delete decoded.aud;
    delete decoded.exp;
    delete decoded.iat;
    delete decoded.iss;

    return decoded;
}

describe('/get-app-data', () => {

    let functionServer: stoppable.StoppableServer;

    beforeEach(async () => {
        functionServer = await startServer();
        await auth0Server.start(AUTH0_PORT);
        await auth0Server.post('/oauth/token').thenReply(200);
    });

    afterEach(async () => {
        await new Promise((resolve) => functionServer.stop(resolve));
        await auth0Server.stop()
    });

    describe("for unauthed users", () => {
        it("returns 401", async () => {
            const response = await getAppData(functionServer);
            expect(response.status).to.equal(401);
        });
    });

    describe("for free users", () => {
        it("returns signed but empty data", async () => {
            const userId = 123;
            const userEmail = 'user@example.com';
            await auth0Server.get('/userinfo').thenJson(200, { sub: userId });
            await auth0Server.get('/api/v2/users/' + userId).thenJson(200, {
                email: userEmail,
                app_metadata: { }
            });

            const response = await getAppData(functionServer, 'abc');
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({ email: userEmail });
        });
    });

    describe("for Pro users", () => {
        it("returns signed but empty data", async () => {
            const userId = 123;
            const userEmail = 'user@example.com';
            const subExpiry = Date.now();

            await auth0Server.get('/userinfo').thenJson(200, { sub: userId });
            await auth0Server.get('/api/v2/users/' + userId).thenJson(200, {
                email: userEmail,
                app_metadata: {
                    "subscription_expiry": subExpiry,
                    "subscription_id": 2,
                    "subscription_plan_id": 550380,
                    "subscription_status": "active"
                }
            });

            const response = await getAppData(functionServer, 'abc');
            expect(response.status).to.equal(200);

            const data = getJwtData(await response.text());
            expect(data).to.deep.equal({
                email: userEmail,
                subscription_expiry: subExpiry,
                subscription_id: 2,
                subscription_plan_id: 550380,
                subscription_status: "active"
            });
        });
    });
});