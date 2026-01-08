#!./node_modules/.bin/ts-node

import prompts from 'prompts';

import { getUsersByEmail } from '../api/src/user-data-facade';

const {
    PADDLE_ID,
    PADDLE_KEY
} = process.env;

const email = process.argv[2];
const subQuantity = +process.argv[3];

(async () => {
    if (isNaN(subQuantity)) {
        throw new Error(`Quantity must be a number, was ${subQuantity}`);
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

    if (![550788, 550789].includes(user.app_metadata.subscription_plan_id)) {
        throw new Error(`User has plan ${user.app_metadata.subscription_plan_id} which is not a Team subscription`);
    }

    const subscriptionId = user.app_metadata.subscription_id;
    const existingQuantity = user.app_metadata.subscription_quantity;

    const { result } = await prompts({
        name: 'result',
        type: 'confirm',
        message: `Update subscription https://vendors.paddle.com/subscriptions/customers/manage/${subscriptionId} from ${
            existingQuantity
        } to ${
            subQuantity
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
        body: `vendor_id=${PADDLE_ID}&vendor_auth_code=${PADDLE_KEY}&subscription_id=${subscriptionId}&quantity=${subQuantity}&bill_immediately=true`
    });

    if (!response.ok) {
        console.error(`Unexpected ${response.status} response`);
        console.log(await response.text());
        process.exit(1);
    } else {
        console.log(await response.text());
    }
})();