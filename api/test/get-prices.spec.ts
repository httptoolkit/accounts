import * as net from 'net';
import { DestroyableServer } from 'destroyable-server';
import { RulePriority } from 'mockttp';

import { expect } from 'chai';

import { ipApiServer, IP_API_PORT, startAPI } from './test-setup/setup.ts';
import { PRICING } from '../src/pricing.ts';

const REAL_IDS = [
    550380,
    550382,
    550789,
    550788
];

// Arbitrary IPs from a quick google. Could change in future, but good quick tests for now:
const SPAIN_IP = '83.56.0.0';
const UK_IP = '101.167.184.0';
const BRAZIL_IP = '101.33.22.0';
const US_IP = '100.0.0.0';
const FIJI_IP = '103.1.180.0';

const getPrices = (
    server: net.Server,
    ip: string = '1.1.1.1'
) => fetch(
    `http://localhost:${(server.address() as net.AddressInfo).port}/api/get-prices`, {
        headers: {
            'X-Forwarded-For': ip
        }
    }
);

interface PaddleProduct {
    sku: string,
    product_id: number,
    product_title: string,
    currency: string,
    price: { net: number },
    subscription: { interval: string }
}

describe('/get-prices', () => {

    let apiServer: DestroyableServer;

    beforeEach(async () => {
        apiServer = await startAPI();
        await ipApiServer.start(IP_API_PORT);

        await ipApiServer.forGet().asPriority(RulePriority.FALLBACK).thenJson(200, {
            status: 'fail',
            message: 'Unknown IP'
        });
    });

    afterEach(async () => {
        await apiServer.destroy();
        await ipApiServer.stop();
    });

    it("can return a price successfully without IP data", async () => {
        await ipApiServer.forAnyRequest().thenJson(200, {
            status: 'fail',
            message: 'Not available'
        });

        const response = await getPrices(apiServer);

        expect(response.status).to.equal(200);

        const data = await response.json();
        expect(data.success).to.equal(true);
        expect(data.response.products[0].currency).to.equal('USD');
    });

    it("can return a price successfully with IP API unavailable", async () => {
        await ipApiServer.forAnyRequest().thenCloseConnection();

        const response = await getPrices(apiServer);

        expect(response.status).to.equal(200);

        const data = await response.json();
        expect(data.success).to.equal(true);
        expect(data.response.products[0].currency).to.equal('USD');
    });

    it("can get the prices with correct metdata", async () => {
        await ipApiServer.forGet(`/json/${SPAIN_IP}`).thenJson(200, {
            status: 'success',
            countryCode: 'ES',
            countryCode3: 'ESP',
            continentCode: 'EU',
            currency: 'EUR'
        });

        const response = await getPrices(apiServer, SPAIN_IP);
        const data = await response.json();

        const products = (data.response.products as Array<PaddleProduct>).map((p) => ({
            sku: p.sku,
            id: p.product_id,
            title: p.product_title,
            currency: p.currency,
            price: p.price.net,
            interval: p.subscription.interval
        }));

        expect(products.map(p => p.id)).to.deep.equal(REAL_IDS);

        products.forEach((product) => {
            expect(product.title).to.include("HTTP Toolkit");
            expect(product.currency).to.equal('EUR'); // Using Spanish IP
            expect(product.sku).not.to.be.empty;
            expect(product.price).to.be.greaterThan(0);
            expect(['year', 'month']).to.include(product.interval);
            expect(product.title).to.include(
                product.interval === 'year'
                    ? 'annual'
                    : 'monthly'
            );
        });
    });

    it("can get prices for the US", async () => {
        await ipApiServer.forGet(`/json/${US_IP}`).thenJson(200, {
            status: 'success',
            countryCode: 'US',
            countryCode3: 'USA',
            continentCode: 'NA',
            currency: 'USD'
        });
        const response = await getPrices(apiServer, US_IP);
        const data = await response.json();

        const products = (data.response.products as Array<PaddleProduct>).map((p) => ({
            sku: p.sku,
            currency: p.currency,
            price: p.price.net
        }));

        expect(products).to.deep.equal([
            { sku: 'pro-monthly', price: 14, currency: 'USD' },
            { sku: 'pro-annual', price: 120, currency: 'USD' },
            { sku: 'team-monthly', price: 22, currency: 'USD' },
            { sku: 'team-annual', price: 204, currency: 'USD' }
        ]);
    });

    it("can get prices for the UK", async () => {
        await ipApiServer.forGet(`/json/${UK_IP}`).thenJson(200, {
            status: 'success',
            countryCode: 'GB',
            countryCode3: 'GBR',
            continentCode: 'EU',
            currency: 'GBP'
        });
        const response = await getPrices(apiServer, UK_IP);
        const data = await response.json();

        const products = (data.response.products as Array<PaddleProduct>).map((p) => ({
            sku: p.sku,
            currency: p.currency,
            price: p.price.net
        }));

        expect(products).to.deep.equal([
            { sku: 'pro-monthly', price: 7, currency: 'GBP' },
            { sku: 'pro-annual', price: 60, currency: 'GBP' },
            { sku: 'team-monthly', price: 11, currency: 'GBP' },
            { sku: 'team-annual', price: 96, currency: 'GBP' }
        ]);
    });

    it("can get prices within the EU", async () => {
        await ipApiServer.forGet(`/json/${SPAIN_IP}`).thenJson(200, {
            status: 'success',
            countryCode: 'FR',
            countryCode3: 'FRA',
            continentCode: 'EU',
            currency: 'EUR'
        });
        const response = await getPrices(apiServer, SPAIN_IP);
        const data = await response.json();

        const products = (data.response.products as Array<PaddleProduct>).map((p) => ({
            sku: p.sku,
            currency: p.currency,
            price: p.price.net
        }));

        expect(products).to.deep.equal([
            { sku: 'pro-monthly', price: 8, currency: 'EUR' },
            { sku: 'pro-annual', price: 72, currency: 'EUR' },
            { sku: 'team-monthly', price: 12, currency: 'EUR' },
            { sku: 'team-annual', price: 108, currency: 'EUR' }
        ]);
    });

    it("can get prices for Brazil", async () => {
        await ipApiServer.forGet(`/json/${BRAZIL_IP}`).thenJson(200, {
            status: 'success',
            countryCode: 'BR',
            countryCode3: 'BRA',
            continentCode: 'SA',
            currency: 'BRL'
        });
        const response = await getPrices(apiServer, BRAZIL_IP);
        const data = await response.json();

        const products = (data.response.products as Array<PaddleProduct>).map((p) => ({
            sku: p.sku,
            currency: p.currency,
            price: p.price.net
        }));

        expect(products).to.deep.equal([
            { sku: 'pro-monthly', price: 24, currency: 'BRL' },
            { sku: 'pro-annual', price: 192, currency: 'BRL' },
            { sku: 'team-monthly', price: 36, currency: 'BRL' },
            { sku: 'team-annual', price: 300, currency: 'BRL' }
        ]);
    });

    it("can get prices for countries without specific pricing", async () => {
        await ipApiServer.forGet(`/json/${FIJI_IP}`).thenJson(200, {
            status: 'success',
            countryCode: 'FJ',
            countryCode3: 'FJI',
            continentCode: 'OC',
            currency: 'FJD'
        });
        const response = await getPrices(apiServer, FIJI_IP);
        const data = await response.json();

        const products = (data.response.products as Array<PaddleProduct>).map((p) => ({
            sku: p.sku,
            currency: p.currency,
            price: p.price.net
        }));

        expect(products).to.deep.equal([
            { sku: 'pro-monthly', price: 5, currency: 'USD' },
            { sku: 'pro-annual', price: 36, currency: 'USD' },
            { sku: 'team-monthly', price: 7, currency: 'USD' },
            { sku: 'team-annual', price: 60, currency: 'USD' }
        ]);
    });


    Object.entries(PRICING).forEach(([key, pricing]) => {
        it(`defines ${key} prices with sensible pricing invariants`, () => {
            expect(pricing.currency).have.lengthOf(3);

            expect(pricing['pro-monthly']).to.be.greaterThan(0);

            // Annual must be divisible by 12, to make the pricing pages look nice.
            // (We do allow .5's here - as otherwise some cases are tricky)
            expect(pricing['pro-annual'] % 12).to.be.oneOf([0, 6]);
            // Annual must be a discount between 50% & 99% of monthly equivalent
            expect(pricing['pro-annual']).to.be.greaterThan(pricing['pro-monthly'] * 7);
            expect(pricing['pro-annual']).to.be.lessThan(pricing['pro-monthly'] * 11);

            // Team pricing is approx 1.5x individual pricing
            expect(pricing['team-monthly']).to.be.greaterThan(pricing['pro-monthly'] * 1.3);
            expect(pricing['team-monthly']).to.be.lessThan(pricing['pro-monthly'] * 1.7);

            // Annual must be divisible by 12, to make the pricing pages look nice:
            expect(pricing['team-annual'] % 12).to.equal(0);
            // Annual must be a discount between 50% & 99% of monthly equivalent
            expect(pricing['team-annual']).to.be.greaterThan(pricing['team-monthly'] * 7);
            expect(pricing['team-annual']).to.be.lessThan(pricing['team-monthly'] * 11);
            // Team annual must be less than Pro annual x2 (but less annual discount here)
            expect(pricing['team-annual']).to.be.greaterThan(pricing['pro-annual'] * 1.4);
            expect(pricing['team-annual']).to.be.lessThan(pricing['pro-annual'] * 1.8);
        });
    });
});