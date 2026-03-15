#!./node_modules/.bin/tsx

import prompts from 'prompts';

import { getUsersByEmail, PayingUserMetadata } from '../api/src/user-data-facade';
import { closeDatabase, initializeDbConnection } from '../api/src/db/database';
import { getPaddleIdForSku } from '../api/src/paddle';
import { PRICING } from '../api/src/pricing';
import { PricedSKU } from '@httptoolkit/accounts';
import { PricedSKUs } from '../api/src/products';

const {
    PADDLE_ID,
    PADDLE_KEY
} = process.env;

const email = process.argv[2];
const sku = process.argv[3] as PricedSKU;
const locationCode = process.argv[4]; // Country code (e.g. USA, GBR) or continent code (e.g. EU, AF)
const quantity = process.argv[5] ? +process.argv[5] : undefined;

(async () => {
    if (!email) {
        throw new Error('Usage: switch-subscription-plan.ts <email> <sku> <location-code> [quantity]');
    }

    if (!PricedSKUs.includes(sku)) {
        throw new Error(`SKU must be one of: ${PricedSKUs.join(', ')}`);
    }

    if (!locationCode) {
        throw new Error('Location code must be a country code (e.g. USA, GBR) or continent code (e.g. EU, AF)');
    }

    const pricing = PRICING[`country:${locationCode}`]
        ?? PRICING[`continent:${locationCode}`];

    if (!pricing) {
        throw new Error(`No pricing found for location code '${locationCode}'`);
    }

    const paddleId = getPaddleIdForSku(sku);
    const price = pricing[sku];
    const currency = pricing.currency;

    const db = await initializeDbConnection();
    const users = await getUsersByEmail(email);

    if (users.length !== 1) {
        throw new Error(`Can't update, found ${users.length} users for email ${email}`);
    }

    const user = users[0];
    const appMetadata = user.app_metadata as PayingUserMetadata | undefined;

    if (
        !appMetadata ||
        appMetadata.subscription_status !== 'active' ||
        appMetadata.subscription_expiry < Date.now()
    ) {
        throw new Error(`User has no active subscription. Data is: ${JSON.stringify(user.app_metadata)}`);
    }

    const subscriptionId = appMetadata.subscription_id;
    const existingQuantity = appMetadata.subscription_quantity;

    const newQuantity = quantity ?? existingQuantity ?? 1;

    const { result } = await prompts({
        name: 'result',
        type: 'confirm',
        message: `Update subscription https://vendors.paddle.com/subscriptions/customers/manage/${subscriptionId} to ${
            sku
        } (paddle id ${paddleId}, x${newQuantity}) at ${
            price
        } ${
            currency
        } each?`
    });

    if (!result) {
        console.log("Cancelled");
        process.exit(1);
    }

    const response = await fetch('https://vendors.paddle.com/api/2.0/subscription/users/update', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            vendor_id: PADDLE_ID!,
            vendor_auth_code: PADDLE_KEY!,
            subscription_id: subscriptionId.toString(),
            quantity: newQuantity.toString(),
            plan_id: paddleId.toString(),
            currency: currency,
            recurring_price: price.toString(),
            bill_immediately: 'true',
            prorate: 'true'
        }).toString()
    });

    if (!response.ok) {
        console.error(`Unexpected ${response.status} response`);
        console.log(await response.text());
        process.exit(1);
    } else {
        console.log(await response.text());
    }

    await closeDatabase(db);
})();
