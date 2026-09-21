#!./node_modules/.bin/tsx

import prompts from 'prompts';

import { getUsersByEmail, PayingUserMetadata } from '../api/src/user-data-facade';
import { closeDatabase, initializeDbConnection } from '../api/src/db/database';

const {
    PADDLE_ID,
    PADDLE_KEY
} = process.env;

const email = process.argv[2];
const price = +process.argv[3];
const currency = (process.argv[4] ?? '').toUpperCase();

(async () => {
    if (!email) {
        throw new Error('Usage: update-subscription-price.ts <email> <price-per-unit> <currency>');
    }

    if (isNaN(price) || price <= 0) {
        throw new Error(`Price must be a positive number, was ${process.argv[3]}`);
    }

    if (!/^[A-Z]{3}$/.test(currency)) {
        throw new Error('Currency must be a 3-letter code, e.g. EUR');
    }

    const db = await initializeDbConnection();
    const users = await getUsersByEmail(email);

    if (users.length !== 1) {
        throw new Error(`Can't update, found ${users.length} users for email ${email}`);
    }

    const user = users[0];
    const metadata = user.app_metadata as PayingUserMetadata | undefined;

    if (
        !metadata ||
        metadata.subscription_status !== 'active' ||
        metadata.subscription_expiry < Date.now()
    ) {
        throw new Error(`User has no active subscription. Data is: ${JSON.stringify(user.app_metadata)}`);
    }

    const subscriptionId = metadata.subscription_id;
    const existingQuantity = metadata.subscription_quantity;

    const { result } = await prompts({
        name: 'result',
        type: 'confirm',
        message: `Update subscription https://vendors.paddle.com/subscriptions/customers/manage/${subscriptionId} to ${
            price
        } ${
            currency
        }?`
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
            quantity: (existingQuantity ?? 1).toString(),
            recurring_price: price.toString(),
            currency: currency,
            prorate: 'false'
        }).toString()
    });

    if (!response.ok) {
        console.error(`Unexpected ${response.status} response`);
        console.log(await response.text());
        process.exit(1);
    }

    // Paddle Classic reports failures as a 200 with success: false, so the status
    // alone doesn't tell us whether this worked:
    const data = await response.json() as
        | { success: true, response: unknown }
        | { success: false, error: { code: number, message: string } };

    if (!data.success) {
        console.error(`Paddle rejected the update: ${data.error.message} (code ${data.error.code})`);
        process.exit(1);
    }

    console.log(data.response);

    await closeDatabase(db);
})();
