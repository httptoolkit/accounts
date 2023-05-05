import * as moment from 'moment';
import { mgmtClient } from '../api/src/auth0';

// Add a trial subscription in Auth0 for the target user. Occasionally useful
// for actual custom trials in some cases, but mostly for open-source contributors
// (Submit a useful PR or issue and get free HTTP Toolkit Pro!)
(async () => {
    const email = process.argv[2];
    const durationString = process.argv[3];

    const [, durationLength, durationType] = /(\d+)(\w+)/.exec(durationString);
    const duration = moment.duration(
        parseInt(durationLength, 10),
        durationType as any
    );

    console.log(`Adding ${duration.asDays()} day subscription for ${email}`);

    const users = await mgmtClient.getUsersByEmail(email);

    let userId: string;
    if (users.length === 1) {
        const metadata = users[0].app_metadata;
        if (
            metadata?.subscription_status &&
            metadata?.subscription_status !== 'deleted' &&
            metadata?.subscription_expiry >= Date.now() // Trials may just expire, without deletion
        ) {
            console.error("User already has subscription", users[0].app_metadata);
            process.exit(1);
        }

        userId = users[0].user_id!;
    } else if (users.length === 0) {
        const user = await mgmtClient.createUser({
            email,
            email_verified: true,
            connection: 'email'
        });
        userId = user.user_id!;
    } else if (users.length > 1) {
        console.error(`Unexpected found ${users.length} users - aborting`);
        return process.exit(1);
    }

    mgmtClient.updateAppMetadata({ id: userId! }, {
        subscription_status: 'trialing',
        subscription_plan_id: 550380, // Pro monthly
        subscription_expiry: Date.now() + duration.asMilliseconds(),
        subscription_id: -1,
        subscription_quantity: 1
    });
})();