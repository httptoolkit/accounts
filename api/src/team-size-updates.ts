import { reportError } from './errors.ts';
import { updateSubscriptionQuantity } from './paddle.ts';
import { TeamOwnerMetadata, updateUserMetadata } from './user-data-facade.ts';
import type { TeamSizeChangePlan } from './team-size.ts';

export async function applyTeamSizeChange(
    ownerId: string,
    subscriptionId: string | number,
    plan: TeamSizeChangePlan
) {
    // Recorded before Paddle bills the upgrade, so its payment webhook can be checked against it:
    if (plan.isUpgrade) {
        await updateUserMetadata<TeamOwnerMetadata>(ownerId, {
            pending_upgrade: { from: plan.paidQuantity, to: plan.newTeamSize, requested_at: Date.now() }
        });
    }

    try {
        // Sequential, as a reset must land before the upgrade that's pro-rated against it:
        for (const { quantity, ...options } of plan.paddleUpdates) {
            await updateSubscriptionQuantity(subscriptionId, quantity, options);
        }
    } catch (e) {
        if (plan.isUpgrade) {
            // Reported separately, so a cleanup failure can't hide the original error:
            await updateUserMetadata<TeamOwnerMetadata>(ownerId, { pending_upgrade: null })
                .catch((cleanupError: unknown) => reportError(
                    cleanupError instanceof Error ? cleanupError : String(cleanupError)
                ));
        }
        throw e;
    }
}
