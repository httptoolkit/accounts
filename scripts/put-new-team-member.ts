#!./node_modules/.bin/tsx

import prompts from 'prompts';

import { getUsersByEmail, TeamOwnerMetadata } from '../api/src/user-data-facade';
import { getMaxTeamSize, getTeamMemberData } from '../api/src/user-data';
import { updateTeamMembership } from '../api/src/team-membership';
import { initializeDbConnection, closeDatabase } from '../api/src/db/database';

// Put a user into any team on the owner's behalf, for support purposes. This runs the
// exact same validation & update logic as the account dashboard's team management UI.
(async () => {
    const ownerEmail = process.argv[2];
    const memberEmail = process.argv[3];

    if (!ownerEmail || !memberEmail) {
        throw new Error('Usage: put-new-team-member <team-owner-email> <new-member-email>');
    }

    const db = await initializeDbConnection();

    try {
        const owners = await getUsersByEmail(ownerEmail);
        if (owners.length !== 1) {
            throw new Error(`Expected 1 user for ${ownerEmail}, found ${owners.length}`);
        }

        const owner = owners[0];
        const ownerId = owner.user_id!;
        const ownerData = owner.app_metadata as TeamOwnerMetadata;
        const members = await getTeamMemberData(ownerId);

        console.log(`Team owner: ${owner.email} (${ownerId})`);
        console.log(`Subscription: ${ownerData.subscription_sku} x${
            ownerData.subscription_quantity
        }, ${ownerData.subscription_status}, expires ${
            ownerData.subscription_expiry ? new Date(ownerData.subscription_expiry).toISOString() : 'never'
        }`);
        console.log(`Members (${ownerData.team_member_ids?.length ?? 0}/${getMaxTeamSize(ownerData)} available):`);
        members.forEach((member) => console.log(` - ${member.email}`));

        const { result } = await prompts({
            name: 'result',
            type: 'confirm',
            message: `Add ${memberEmail} to this team?`
        });

        if (!result) {
            console.log('Cancelled');
            process.exitCode = 1;
            return;
        }

        await updateTeamMembership(ownerId, { emailsToAdd: [memberEmail] });
        console.log(`Added ${memberEmail} to ${owner.email}'s team`);
    } finally {
        await closeDatabase(db);
    }
})().catch((e) => {
    console.error(e.statusCode ? `Failed (${e.statusCode}): ${e.message}` : e);
    process.exit(1);
});
