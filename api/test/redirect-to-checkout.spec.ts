import * as net from 'net';
import fetch from 'node-fetch';
import stoppable from 'stoppable';

import { expect } from 'chai';

import { startServer } from './test-util';
import { SKU } from '../../module/src/types';

const getCheckoutUrl = (
    server: net.Server,
    email: string,
    sku: SKU,
    ip: string = '1.1.1.1'
) => fetch(
    `http://localhost:${
        (server.address() as net.AddressInfo).port
    }/redirect-to-checkout?sku=${sku}&email=${email}&source=site.example`, {
        headers: {
            'x-nf-client-connection-ip': ip
        },
        redirect: 'manual'
    }
);

describe('/redirect-to-checkout', () => {

    let functionServer: stoppable.StoppableServer;

    beforeEach(async () => {
        functionServer = await startServer();
    });

    afterEach(async () => {
        await new Promise((resolve) => functionServer.stop(resolve));
    });

    it("redirects to Paddle by default for Pro-Monthly", async () => {
        const response = await getCheckoutUrl(
            functionServer,
            'test@email.example',
            'pro-monthly'
        );

        expect(response.status).to.equal(302);
        expect(response.headers.get('location')).to.equal(
            `https://pay.paddle.com/checkout/550380?guest_email=${
                encodeURIComponent('test@email.example')
            }&referring_domain=site.example`
        );
    });

    it("redirects to Paddle by default for Pro-Annual", async () => {
        const response = await getCheckoutUrl(
            functionServer,
            'annual-test@email.example',
            'pro-annual'
        );

        expect(response.status).to.equal(302);
        expect(response.headers.get('location')).to.equal(
            `https://pay.paddle.com/checkout/550382?guest_email=${
                encodeURIComponent('annual-test@email.example')
            }&referring_domain=site.example`
        );
    });

    it("fails if no SKU is provided", async () => {
        const response = await getCheckoutUrl(
            functionServer,
            'test@email.example',
            '' as any
        );

        expect(response.status).to.equal(400);
    });

    it("fails if no email is provided", async () => {
        const response = await getCheckoutUrl(
            functionServer,
            '',
            'pro-monthly'
        );

        expect(response.status).to.equal(400);
    });

    // TODO: For now this always redirects to Paddle - later it will
    // intelligently route to the correct payment gateway.

});