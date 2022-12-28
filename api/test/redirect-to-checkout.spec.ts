import * as net from 'net';
import fetch from 'node-fetch';
import stoppable from 'stoppable';

import { expect } from 'chai';

import {
    exchangeRateServer,
    EXCHANGE_RATE_API_PORT,
    givenExchangeRate,
    paddleServer,
    PADDLE_PORT,
    startServer
} from './test-util';
import type { SKU } from '../../module/src/types';

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

        // Return checkout URLs containing the raw params explicitly to assert on:
        await paddleServer.start(PADDLE_PORT);
        await paddleServer.forPost('/api/2.0/product/generate_pay_link')
            .thenCallback(async (req) => {
                const params = await req.body.getFormData();

                const prices = Object.entries(params!)
                    .filter(([key]) => key.startsWith('prices'))
                    .map(([_, value]) => value);

                return {
                    status: 200,
                    json: {
                        success: true,
                        response: {
                            url: `https://paddle.example?prices=${prices.join(',')}`
                        }
                    }
                };
            });

        await exchangeRateServer.start(EXCHANGE_RATE_API_PORT);
    });

    afterEach(async () => {
        await new Promise((resolve) => functionServer.stop(resolve));
        await paddleServer.stop();
        await exchangeRateServer.stop();
    });

    it("redirects to Paddle by default for Pro-Monthly", async () => {
        await givenExchangeRate('USD', 2);
        const response = await getCheckoutUrl(
            functionServer,
            'test@email.example',
            'pro-monthly'
        );

        expect(response.status).to.equal(302);
        expect(response.headers.get('location')).to.equal(
            'https://paddle.example/?prices=USD:7,EUR:3.5'
        );
    });

    it("redirects to Paddle by default for Pro-Annual", async () => {
        await givenExchangeRate('USD', 2);
        const response = await getCheckoutUrl(
            functionServer,
            'annual-test@email.example',
            'pro-annual'
        );

        expect(response.status).to.equal(302);
        expect(response.headers.get('location')).to.equal(
            'https://paddle.example/?prices=USD:60,EUR:30'
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