import * as net from 'net';
import fetch from 'node-fetch';
import stoppable from 'stoppable';

import { expect } from 'chai';

import {
    exchangeRateServer,
    EXCHANGE_RATE_API_PORT,
    givenExchangeRate,
    ipApiServer,
    IP_API_PORT,
    paddleServer,
    PADDLE_PORT,
    startServer
} from './test-util';
import type { SKU } from '../../module/src/types';

const getCheckoutUrl = (
    server: net.Server,
    email: string,
    sku: SKU,
    options: {
        ip?: string,
        passthrough?: string,
        quantity?: number
    } = {}
) => fetch(
    `http://localhost:${
        (server.address() as net.AddressInfo).port
    }/redirect-to-checkout?sku=${sku}&email=${email}&source=site.example${
        options.passthrough ? `&passthrough=${encodeURIComponent(options.passthrough)}` : ''
    }${
        options.quantity !== undefined ? `&quantity=${options.quantity}` : ''
    }`, {
        headers: {
            'x-nf-client-connection-ip': options.ip ?? '1.1.1.1'
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

                const passthrough = params!['passthrough'] as string | undefined;

                const emailParam = params?.['customer_email']
                    ? `&email=${params['customer_email']}`
                    : '';

                const quantityParam = params?.['quantity']
                    ? `&quantity=${params['quantity']}`
                    : '';

                return {
                    status: 200,
                    json: {
                        success: true,
                        response: {
                            url: `https://paddle.example?prices=${prices.join(',')}${
                                emailParam
                            }${
                                quantityParam
                            }&passthrough=${
                                passthrough ? encodeURIComponent(passthrough) : '<undefined>'
                            }`
                        }
                    }
                };
            });

        await ipApiServer.start(IP_API_PORT);
        await exchangeRateServer.start(EXCHANGE_RATE_API_PORT);
    });

    afterEach(async () => {
        await new Promise((resolve) => functionServer.stop(resolve));
        await paddleServer.stop();
        await exchangeRateServer.stop();
        await ipApiServer.stop();
    });

    it("redirects to Paddle by default for Pro-Monthly", async () => {
        await givenExchangeRate('USD', 2);
        const response = await getCheckoutUrl(
            functionServer,
            'test@email.example',
            'pro-monthly'
        );

        expect(response.status).to.equal(302);

        const redirectTarget = response.headers.get('location');
        const targetUrl = new URL(redirectTarget!);
        expect(targetUrl.searchParams.get('prices')).to.equal('USD:7,EUR:3.5');
        expect(targetUrl.searchParams.get('email')).to.equal('test@email.example');
        expect(targetUrl.searchParams.get('quantity')).to.equal(null);
    });

    it("redirects to Paddle by default for Pro-Annual", async () => {
        await givenExchangeRate('USD', 2);
        const response = await getCheckoutUrl(
            functionServer,
            'annual-test@email.example',
            'pro-annual'
        );

        expect(response.status).to.equal(302);
        expect(response.headers.get('location')).to.include(
            'https://paddle.example/?prices=USD:60,EUR:30'
        );
        expect(response.headers.get('location')).to.include('&email=annual-test@email.example');
    });

    it("includes IP source data in passthrough by default", async () => {
        await givenExchangeRate('USD', 2);
        const response = await getCheckoutUrl(
            functionServer,
            'test@email.example',
            'pro-monthly'
        );

        expect(response.status).to.equal(302);

        const redirectTarget = response.headers.get('location');
        const targetUrl = new URL(redirectTarget!);

        const passthroughParams = JSON.parse(targetUrl.searchParams.get('passthrough')!);

        expect(passthroughParams.id.length).to.equal(16);
        delete passthroughParams.id; // Random, so ignore this below

        expect(passthroughParams).to.deep.equal({
            country: 'unknown',
            continent: 'unknown',
        });
    });

    it("combines provided & IP-based passthrough data", async () => {
        await givenExchangeRate('USD', 2);
        const response = await getCheckoutUrl(
            functionServer,
            'test@email.example',
            'pro-monthly',
            { passthrough: JSON.stringify({ testParam: 'testValue' }) }
        );

        expect(response.status).to.equal(302);
        const redirectTarget = response.headers.get('location');
        const targetUrl = new URL(redirectTarget!);

        const passthroughParams = JSON.parse(targetUrl.searchParams.get('passthrough')!);

        expect(passthroughParams.id.length).to.equal(16);
        delete passthroughParams.id; // Random, so ignore this below

        expect(passthroughParams).to.deep.equal({
            testParam: 'testValue',
            country: 'unknown',
            continent: 'unknown',
        });
    });

    it("fails if no SKU is provided", async () => {
        await givenExchangeRate('USD', 2);
        const response = await getCheckoutUrl(
            functionServer,
            'test@email.example',
            '' as any
        );

        expect(response.status).to.equal(400);
    });

    it("fails if no email is provided", async () => {
        await givenExchangeRate('USD', 2);
        const response = await getCheckoutUrl(
            functionServer,
            '',
            'pro-monthly'
        );

        expect(response.status).to.equal(400);
    });

    it("doesn't fail if the email is explicitly not provided", async () => {
        await givenExchangeRate('USD', 2);

        const response = await getCheckoutUrl(
            functionServer,
            '*',
            'pro-monthly'
        );

        expect(response.status).to.equal(302);

        expect(response.headers.get('location')).to.include(
            'https://paddle.example/?prices=USD:7,EUR:3.5'
        );
        expect(response.headers.get('location')).not.to.include('email=');
    });

    it("redirects to Paddle by default for Team-Annual", async () => {
        await givenExchangeRate('USD', 2);
        const response = await getCheckoutUrl(
            functionServer,
            'test@email.example',
            'team-annual',
            { quantity: 5 }
        );

        expect(response.status).to.equal(302);

        const redirectTarget = response.headers.get('location');
        const targetUrl = new URL(redirectTarget!);
        expect(targetUrl.searchParams.get('prices')).to.equal('USD:96,EUR:48');
        expect(targetUrl.searchParams.get('email')).to.equal('test@email.example');
        expect(targetUrl.searchParams.get('quantity')).to.equal('5');
    });

    it("fails for team SKUs if no quantity is provided", async () => {
        await givenExchangeRate('USD', 2);
        const response = await getCheckoutUrl(
            functionServer,
            'test@email.example',
            'team-annual'
        );

        expect(response.status).to.equal(400);
        const responseBody = await response.text()
        expect(responseBody).to.equal('Quantity parameter is required for team SKUs');
    });

    // TODO: For now this always redirects to Paddle - later it will
    // intelligently route to the correct payment gateway.

});