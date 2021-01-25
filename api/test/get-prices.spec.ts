import * as net from 'net';
import fetch from 'node-fetch';

import { expect } from 'chai';

import { startServer } from './test-util';
import stoppable from 'stoppable';

const REAL_IDS = [
    550380,
    550382,
    550788,
    550789
];

const getPrices = (server: net.Server, productIds: number[]) => fetch(
    `http://localhost:${
        (server.address() as net.AddressInfo).port
    }/get-prices?product_ids=${
        productIds.join(',')
    }`
);

interface PaddleProduct {
    product_id: number,
    product_title: string,
    currency: string,
    price: { net: number },
    subscription: { interval: string }
}

// Test the pricing API. Note that this is _not_ mocked, we use the real pricing API.
// This might need to change if the pricing API isn't totally reliable, but it should be...
describe('/get-prices', () => {

    let functionServer: stoppable.StoppableServer;

    beforeEach(async () => {
        functionServer = await startServer();
    });

    afterEach(async () => {
        await new Promise((resolve) => functionServer.stop(resolve));
    });

    it("can get the prices successfully", async () => {
        const response = await getPrices(functionServer, REAL_IDS);

        expect(response.status).to.equal(200);

        const data = await response.json();
        expect(data.success).to.equal(true);
    });

    it("can get the prices correctly", async () => {
        const response = await getPrices(functionServer, REAL_IDS);
        const data = await response.json();

        const products = (data.response.products as Array<PaddleProduct>).map((p) => ({
            id: p.product_id,
            title: p.product_title,
            currency: p.currency,
            price: p.price.net,
            interval: p.subscription.interval
        }));

        expect(products.map(p => p.id)).to.deep.equal(REAL_IDS);

        products.forEach((product) => {
            expect(product.title).to.include("HTTP Toolkit");
            expect(product.currency).not.to.be.empty;
            expect(product.price).to.be.greaterThan(0);
            expect(['year', 'month']).to.include(product.interval);
            expect(product.title).to.include(
                product.interval === 'year'
                    ? 'annual'
                    : 'monthly'
            );
        });
    });

    it("returns a clear error for invalid ids", async () => {
        const response = await getPrices(functionServer, [-1]);
        expect(response.status).to.equal(404);
    });
});