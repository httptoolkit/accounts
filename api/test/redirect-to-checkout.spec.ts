import * as net from 'net';
import { DestroyableServer } from 'destroyable-server';

import { expect } from 'chai';

import {
    exchangeRateServer,
    EXCHANGE_RATE_API_PORT,
    givenExchangeRate,
    givenBlackFridayDealEnded,
    ipApiServer,
    IP_API_PORT,
    startAPI
} from './test-setup/setup.ts';
import {
    paddleServer,
    PADDLE_PORT,
} from './test-setup/paddle.ts';
import type { SKU } from '@httptoolkit/accounts';

const getCheckoutUrl = (
    server: net.Server,
    email: string,
    sku: SKU,
    options: {
        ip?: string,
        passthrough?: string,
        quantity?: number,
        paymentProvider?: string,
        discountCode?: string,
        returnUrl?: string
    } = {}
) => fetch(
    `http://localhost:${
        (server.address() as net.AddressInfo).port
    }/api/redirect-to-checkout?sku=${sku}&email=${email}&source=site.example${
        options.passthrough ? `&passthrough=${encodeURIComponent(options.passthrough)}` : ''
    }${
        options.quantity !== undefined ? `&quantity=${options.quantity}` : ''
    }${
        options.paymentProvider ? `&paymentProvider=${options.paymentProvider}` : ''
    }${
        options.discountCode ? `&discountCode=${options.discountCode}` : ''
    }${
        options.returnUrl ? `&returnUrl=${encodeURIComponent(options.returnUrl)}` : ''
    }`, {
        headers: {
            'X-Forwarded-For': options.ip ?? '1.1.1.1'
        },
        redirect: 'manual'
    }
);

describe('/redirect-to-checkout', () => {

    let apiServer: DestroyableServer;

    beforeEach(async () => {
        apiServer = await startAPI();

        // Return checkout URLs containing the raw params explicitly to assert on:
        await paddleServer.start(PADDLE_PORT);
        await paddleServer.forPost('/api/2.0/product/generate_pay_link')
            .thenCallback(async (req) => {
                const params = await req.body.getFormData();

                const prices = Object.entries(params!)
                    .filter(([key]) => key.startsWith('prices'))
                    .map(([_, value]) => value);

                const recurringPrices = Object.entries(params!)
                    .filter(([key]) => key.startsWith('recurring_prices'))
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
                            url: `https://paddle.example/?prices=${prices.join(',')}${
                                emailParam
                            }${
                                quantityParam
                            }&passthrough=${
                                passthrough ? encodeURIComponent(passthrough) : '<undefined>'
                            }&product=${params!['product_id']}&recurringPrices=${
                                recurringPrices.join(',')
                            }&quantityVariable=${params!['quantity_variable'] ?? ''}&expires=${
                                params!['expires'] ?? ''
                            }&coupon=${params!['coupon_code'] ?? ''}&returnUrl=${
                                encodeURIComponent((params!['return_url'] as string | undefined) ?? '')
                            }`
                        }
                    }
                };
            });

        await ipApiServer.start(IP_API_PORT);
        await exchangeRateServer.start(EXCHANGE_RATE_API_PORT);
    });

    afterEach(async () => {
        await apiServer.destroy();
        await paddleServer.stop();
        await exchangeRateServer.stop();
        await ipApiServer.stop();
    });

    it("redirects to Paddle by default for Pro-Monthly", async () => {
        await givenExchangeRate('USD', 2);
        const response = await getCheckoutUrl(
            apiServer,
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
            apiServer,
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
            apiServer,
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
            apiServer,
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
            apiServer,
            'test@email.example',
            '' as any
        );

        expect(response.status).to.equal(400);
    });

    it("fails if no email is provided", async () => {
        await givenExchangeRate('USD', 2);
        const response = await getCheckoutUrl(
            apiServer,
            '',
            'pro-monthly'
        );

        expect(response.status).to.equal(400);
    });

    it("doesn't fail if the email is explicitly not provided", async () => {
        await givenExchangeRate('USD', 2);

        const response = await getCheckoutUrl(
            apiServer,
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
            apiServer,
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
            apiServer,
            'test@email.example',
            'team-annual'
        );

        expect(response.status).to.equal(400);
        const responseBody = await response.text()
        expect(responseBody).to.equal('Quantity parameter is required for team SKUs');
    });

    describe("after the checkout completes", () => {

        for (const sku of ['pro-monthly', 'pro-annual', 'pro-perpetual'] as const) {
            it(`returns ${sku} customers to our thank you page by default`, async () => {
                await givenExchangeRate('USD', 2);
                const response = await getCheckoutUrl(
                    apiServer,
                    'return-test@email.example',
                    sku
                );

                const targetUrl = new URL(response.headers.get('location')!);
                expect(targetUrl.searchParams.get('returnUrl')).to.equal(
                    'https://httptoolkit.com/web-purchase-thank-you/'
                );
            });
        }

        it("returns customers to a specific page if one is requested", async () => {
            await givenExchangeRate('USD', 2);
            const response = await getCheckoutUrl(
                apiServer,
                'return-test@email.example',
                'pro-perpetual',
                { returnUrl: 'https://httptoolkit.com/app-purchase-thank-you/' }
            );

            const targetUrl = new URL(response.headers.get('location')!);
            expect(targetUrl.searchParams.get('returnUrl')).to.equal(
                'https://httptoolkit.com/app-purchase-thank-you/'
            );
        });

        it("doesn't add a default thank you page for Team checkouts", async () => {
            await givenExchangeRate('USD', 2);
            const response = await getCheckoutUrl(
                apiServer,
                'return-test@email.example',
                'team-annual',
                { quantity: 5 }
            );

            const targetUrl = new URL(response.headers.get('location')!);
            expect(targetUrl.searchParams.get('returnUrl')).to.equal('');
        });
    });

    describe("for the Black Friday lifetime license deal", () => {

        it("stops offering checkouts once the deal has ended", async () => {
            givenBlackFridayDealEnded();

            const response = await getCheckoutUrl(
                apiServer,
                'test@email.example',
                'pro-perpetual'
            );

            expect(response.status).to.equal(410);
            expect(response.headers.get('location')).to.equal(null);
            expect(await response.text()).to.include('deal has now ended');
        });

        it("still offers subscriptions once the deal has ended", async () => {
            givenBlackFridayDealEnded();
            await givenExchangeRate('USD', 2);

            const response = await getCheckoutUrl(
                apiServer,
                'test@email.example',
                'pro-annual'
            );

            expect(response.status).to.equal(302);
        });

        it("ends at the end of December 1st 2026, anywhere on Earth", async () => {
            delete process.env.BLACK_FRIDAY_DEAL_END;
            const { getBlackFridayDealEnd } = await import('../src/products.ts');

            expect(new Date(getBlackFridayDealEnd()).toISOString()).to.equal('2026-12-02T12:00:00.000Z');
        });

        it("creates checkout links that expire when the deal does", async () => {
            await givenExchangeRate('USD', 2);
            const response = await getCheckoutUrl(
                apiServer,
                'expiry-test@email.example',
                'pro-perpetual'
            );

            const targetUrl = new URL(response.headers.get('location')!);
            expect(targetUrl.searchParams.get('expires')).to.equal('2100-01-01');
        });

        it("redirects to a one-off Paddle checkout", async () => {
            await givenExchangeRate('USD', 2);
            const response = await getCheckoutUrl(
                apiServer,
                'test@email.example',
                'pro-perpetual'
            );

            expect(response.status).to.equal(302);

            const targetUrl = new URL(response.headers.get('location')!);
            expect(targetUrl.origin).to.equal('https://paddle.example');
            expect(targetUrl.searchParams.get('product')).to.equal('932080');
            expect(targetUrl.searchParams.get('prices')).to.equal('USD:240,EUR:120');
            expect(targetUrl.searchParams.get('recurringPrices')).to.equal('');
            expect(targetUrl.searchParams.get('email')).to.equal('test@email.example');
            expect(targetUrl.searchParams.get('quantity')).to.equal('1');
            expect(targetUrl.searchParams.get('quantityVariable')).to.equal('0');
            expect(targetUrl.searchParams.get('coupon')).to.equal('BLACKFRIDAY26');
        });

        it("still sends recurring prices for subscriptions", async () => {
            await givenExchangeRate('USD', 2);
            const response = await getCheckoutUrl(
                apiServer,
                'test@email.example',
                'pro-annual'
            );

            const targetUrl = new URL(response.headers.get('location')!);
            expect(targetUrl.searchParams.get('product')).to.equal('550382');
            expect(targetUrl.searchParams.get('recurringPrices')).to.equal('USD:60,EUR:30');
            expect(targetUrl.searchParams.get('quantityVariable')).to.equal('');
            expect(targetUrl.searchParams.get('expires')).to.equal('');
            expect(targetUrl.searchParams.get('coupon')).to.equal('');
        });

        it("always applies the deal's coupon, replacing any other discount code", async () => {
            await givenExchangeRate('USD', 2);
            const response = await getCheckoutUrl(
                apiServer,
                'coupon-test@email.example',
                'pro-perpetual',
                { discountCode: 'OTHERCODE' }
            );

            const targetUrl = new URL(response.headers.get('location')!);
            expect(targetUrl.searchParams.get('coupon')).to.equal('BLACKFRIDAY26');
        });

        it("still passes other discount codes through for subscriptions", async () => {
            await givenExchangeRate('USD', 2);
            const response = await getCheckoutUrl(
                apiServer,
                'coupon-test@email.example',
                'pro-annual',
                { discountCode: 'OTHERCODE' }
            );

            const targetUrl = new URL(response.headers.get('location')!);
            expect(targetUrl.searchParams.get('coupon')).to.equal('OTHERCODE');
        });

        it("uses Paddle even in countries that buy subscriptions through PayPro", async () => {
            const VIETNAM_IP = '14.160.0.0';
            await ipApiServer.forGet(`/json/${VIETNAM_IP}`).thenJson(200, {
                status: 'success',
                countryCode: 'VN',
                countryCode3: 'VNM',
                continentCode: 'AS',
                currency: 'VND'
            });
            await givenExchangeRate('USD', 2);

            const response = await getCheckoutUrl(
                apiServer,
                'test@email.example',
                'pro-perpetual',
                { ip: VIETNAM_IP }
            );

            expect(response.status).to.equal(302);

            const targetUrl = new URL(response.headers.get('location')!);
            expect(targetUrl.origin).to.equal('https://paddle.example');
            expect(targetUrl.searchParams.get('prices')).to.equal('USD:120,EUR:60');
        });

        it("refuses to use PayPro", async () => {
            const response = await getCheckoutUrl(
                apiServer,
                'test@email.example',
                'pro-perpetual',
                { paymentProvider: 'paypro' }
            );

            expect(response.status).to.equal(400);
        });
    });

});