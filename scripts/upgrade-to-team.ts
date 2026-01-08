import prompts from 'prompts';

import { mgmtClient } from '../api/src/user-data-facade';

const {
    PADDLE_ID,
    PADDLE_KEY
} = process.env;

const email = process.argv[2];
const planId = +process.argv[3];
const subQuantity = +process.argv[4];

const TEAM_PLAN_IDS = [550788, 550789];

(async () => {
    if (!TEAM_PLAN_IDS.includes(planId)) {
        throw new Error(`Specified plan id (${planId}) is not a Team plan`);
        // Note that it's impossible to Paddle's API to switch from Team plans to Pro, so we couldn't
        // work around this even if we tried.
    }

    if (isNaN(subQuantity)) {
        throw new Error(`Quantity must be a number, was ${subQuantity}`);
    }

    const users = await mgmtClient.getUsersByEmail(email);

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

    if (TEAM_PLAN_IDS.includes(user.app_metadata.subscription_plan_id)) {
        throw new Error(`User has plan ${user.app_metadata.subscription_plan_id} which is already a Team subscription`);
    }

    const subscriptionId = user.app_metadata.subscription_id;

    const { result } = await prompts({
        name: 'result',
        type: 'confirm',
        message: `Upgrade subscription https://vendors.paddle.com/subscriptions/customers/manage/${subscriptionId} from Pro to a Team of ${
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
        body: [
            `vendor_id=${PADDLE_ID}`,
            `vendor_auth_code=${PADDLE_KEY}`,
            `subscription_id=${subscriptionId}`,
            `plan_id=${planId}`,
            `quantity=${subQuantity}`,
            'prorate=true',
            `bill_immediately=true`
        ].join('&')
    });

    if (!response.ok) {
        console.error(`Unexpected ${response.status} response`);
        response.body.pipe(process.stderr);
        response.body.on('end', () => process.exit(1));
    } else {
        response.body.pipe(process.stdout);
    }
})();