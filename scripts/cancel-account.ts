import { getUsersByEmail, updateUserMetadata } from '../api/src/auth0';

// Cancel an account - closing the subscription and setting the expiry date to
// now. This immediately ends any active subscription, useful for refunds or
// migrating data to a different account etc.

// This doesn't change any state in Paddle, so make sure any updates that need
// to happen there are fired first!
(async () => {
    const email = process.argv[2];
    console.log(`Cancelling account for ${email}`);

    const users = await getUsersByEmail(email);

    if (users.length !== 1) {
        console.error(`Unexpected found ${users.length} users - aborting`);
        process.exit(1);
    }

    const userId = users[0].user_id!;

    await updateUserMetadata(userId, {
        subscription_status: 'deleted',
        subscription_expiry: Date.now()
    });
})();