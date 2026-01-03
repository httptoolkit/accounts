import prompts from 'prompts';

import { getUsersByEmail } from '../api/src/user-data-facade';

const {
    PADDLE_ID,
    PADDLE_KEY
} = process.env;

const email = process.argv[2];
const newPlan = process.argv[3]
const price = +process.argv[4];
const currency = process.argv[5];
const quantity = process.argv[6] ? +process.argv[6] : undefined;

(async () => {
    if (isNaN(price)) {
        throw new Error(`Price must be a number, was ${price}`);
    }

    if (!currency || currency.length !== 3) {
        throw new Error('Currency must be a 3-letter code, e.g. EUR');
    }

    const users = await getUsersByEmail(email);

    if (users.length !== 1) {
        throw new Error(`Can't update, found ${users.length} users for email ${email}`);
    }

    const user = users[0];

    if (
        !user.app_metadata ||
        user.app_metadata.subscription_status !== 'active' ||
        user.app_metadata.subscription_expiry < Date.now()
    ) {
        throw new Error(`User has no active subscription. Data is: ${user.app_metadata}`);
    }

    const subscriptionId = user.app_metadata.subscription_id;
    const existingQuantity = user.app_metadata.subscription_quantity;

    const newQuantity = quantity ?? existingQuantity ?? 1;

    const { result } = await prompts({
        name: 'result',
        type: 'confirm',
        message: `Update subscription https://vendors.paddle.com/subscriptions/customers/manage/${subscriptionId} to ${
            newPlan
        } (x${newQuantity}) at ${
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
            subscription_id: subscriptionId,
            quantity: newQuantity,
            plan_id: newPlan,
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
})();