import { initSentry, catchErrors, reportError } from '../errors.ts';
initSentry();

import _ from 'lodash';
import moment from 'moment';
import type { SKU } from '@httptoolkit/accounts';
import * as querystring from 'querystring';
import log from 'loglevel';

import {
    PayingUserMetadata,
    TeamOwnerMetadata,
    getOrCreateUser,
    updateUserMetadata
} from '../user-data-facade.ts';
import {
    validatePaddleWebhook,
    PaddleWebhookData,
    PaymentSuccessHookData,
    getSkuForPaddleId
} from '../paddle.ts';
import {
    getSku,
    getSkuInterval,
    isProSubscription,
    isTeamSubscription
} from '../products.ts';
import {
    banUser,
    reportSuccessfulCheckout,
    updateProUserData,
    updateTeamData,
    parseCheckoutPassthrough
} from '../webhook-handling.ts';
import { setRevenueTraits } from '../accounting.ts';
import { RequestedUpgrade, checkProratedCharge } from '../proration.ts';

function getSubscriptionFromHookData(hookData: PaddleWebhookData): Partial<PayingUserMetadata> {
    if (
        hookData.alert_name === 'subscription_created' ||
        hookData.alert_name === 'subscription_updated'
    ) {
        // New subscription: get & store the full data for this user

        // 1 day of slack for ongoing renewals (we don't know what time they renew).
        const endDate = moment(hookData.next_bill_date).add(1, 'day').valueOf();
        const quantity = 'quantity' in hookData
            ? hookData.quantity
            : hookData.new_quantity;

        const planId = parseInt(hookData.subscription_plan_id, 10);

        return {
            subscription_status: hookData.status,
            payment_provider: 'paddle',
            paddle_user_id: hookData.user_id,
            subscription_id: hookData.subscription_id,
            subscription_sku: getSkuForPaddleId(planId),
            subscription_quantity: parseInt(quantity, 10),
            subscription_expiry: endDate,
            update_url: hookData.update_url,
            cancel_url: hookData.cancel_url
        };
    } else if (hookData.alert_name === 'subscription_cancelled') {
        // Cancelled subscription - we'll never hear about this sub again. Mark is
        // as finished, and save the current end date so we know when it really stops.

        // Cancelled subscriptions end of the last day of the current plan
        const endDate = moment(hookData.cancellation_effective_date).valueOf();

        const planId = parseInt(hookData.subscription_plan_id, 10);

        return {
            subscription_status: 'deleted',
            payment_provider: 'paddle',
            paddle_user_id: hookData.user_id,
            subscription_id: hookData.subscription_id,
            subscription_sku: getSkuForPaddleId(planId),
            subscription_expiry: endDate,
            update_url: hookData.update_url,
            cancel_url: hookData.cancel_url
        };
    } else if (hookData.alert_name === 'subscription_payment_succeeded') {
        // Subscription has renewed (or started for the first time), update the expiry date.

        // 1 day of slack for ongoing renewals (we don't know what time they renew).
        const endDate = moment(hookData.next_bill_date).add(1, 'day').valueOf();

        const planId = parseInt(hookData.subscription_plan_id, 10);

        return {
            subscription_status: hookData.status,
            payment_provider: 'paddle',
            paddle_user_id: hookData.user_id,
            subscription_id: hookData.subscription_id,
            subscription_sku: getSkuForPaddleId(planId),
            subscription_expiry: endDate,
            subscription_quantity: parseInt(hookData.quantity, 10),
            subscription_coupon: hookData.coupon === undefined
                ? undefined // Unknown, leave as-is
                : hookData.coupon || false,
            last_receipt_url: hookData.receipt_url,
            update_url: hookData.update_url,
            cancel_url: hookData.cancel_url
        };
    } else if (hookData.alert_name === 'subscription_payment_failed') {
        // We wait briefly, then try to charge again, a couple of times. If the
        // final charge fails, their subscription will be cancelled automatically.
        const endDate = hookData.next_retry_date
            ? moment(hookData.next_retry_date).add(1, 'day').valueOf()
            : undefined;

        const planId = parseInt(hookData.subscription_plan_id, 10);

        return {
            subscription_status: hookData.next_retry_date ? 'past_due' : 'deleted',
            payment_provider: 'paddle',
            paddle_user_id: hookData.user_id,
            subscription_id: hookData.subscription_id,
            subscription_sku: getSkuForPaddleId(planId),
            subscription_expiry: endDate,
            update_url: hookData.update_url,
            cancel_url: hookData.cancel_url,
        };
    }

    // Should never happen - we effectively return 'update nothing'
    return {};
}

/**
 * Mid-term license additions are billed immediately as their own pro-rated payment. We
 * don't calculate that charge - Paddle does - but we do show customers an estimate of it
 * beforehand, so we check each one against the upgrade we requested.
 */
function checkPaymentAgainstUpgrade(
    paddleData: PaymentSuccessHookData,
    sku: SKU,
    upgrade: RequestedUpgrade | undefined
) {
    // Discounted charges won't match the plain pro-rata rate:
    if (paddleData.coupon) return;

    const netAmount = parseFloat(paddleData.sale_gross) - parseFloat(paddleData.payment_tax);

    const check = checkProratedCharge({
        netAmount,
        currency: paddleData.currency,
        unitPrice: parseFloat(paddleData.unit_price),
        quantity: parseInt(paddleData.quantity, 10),
        nextBillDate: paddleData.next_bill_date,
        interval: getSkuInterval(sku)
    }, upgrade);

    if (!check) return; // A normal full-period renewal

    const summary = `${netAmount} ${paddleData.currency} on subscription ${
        paddleData.subscription_id
    } (expected ${check.expectedAmount ?? 'no charge'}, ${
        check.daysRemaining
    }/${check.daysInPeriod} days)`;

    if (check.matchesExpectation) {
        log.info(`Pro-rated charge as expected: ${summary}`);
    } else {
        reportError(`Pro-rated charge does not match our estimate: ${summary}`, {
            extraMetadata: { check, upgrade }
        });
    }
}

export const handler = catchErrors(async (event) => {
    const paddleData = querystring.parse(event.body || '') as unknown as PaddleWebhookData;
    log.debug('Received Paddle webhook', JSON.stringify(paddleData));

    validatePaddleWebhook(paddleData);

    // Paddle uses casing in emails, whilst it seems that auth0 does not:
    // https://community.auth0.com/t/creating-a-user-converts-email-to-lowercase/6678/4
    const email = paddleData.email.toLowerCase();

    if ([
        'subscription_created',
        'subscription_updated',
        'subscription_cancelled',
        'subscription_payment_succeeded',
        'subscription_payment_failed'
    ].includes(paddleData.alert_name)) {
        const userData = getSubscriptionFromHookData(paddleData);
        const sku = getSku(userData);

        if (isTeamSubscription(sku)) {
            // Read before updating, as payment confirms (and so clears) any pending upgrade:
            const owner = paddleData.alert_name === 'subscription_payment_succeeded'
                ? await getOrCreateUser(email)
                : undefined;
            const pendingUpgrade = (owner?.app_metadata as TeamOwnerMetadata | undefined)?.pending_upgrade;

            log.info(`Updating Team user ${email} to ${JSON.stringify(userData)}`);
            await updateTeamData(email, userData, {
                deferQuantityDecrease: paddleData.alert_name === 'subscription_updated'
            });

            if (paddleData.alert_name === 'subscription_payment_succeeded') {
                try {
                    checkPaymentAgainstUpgrade(paddleData, sku!, pendingUpgrade && {
                        from: pendingUpgrade.from,
                        to: pendingUpgrade.to,
                        requestedAt: pendingUpgrade.requested_at
                    });
                } catch (e) {
                    reportError(e instanceof Error ? e : String(e));
                }

                if (pendingUpgrade) {
                    await updateUserMetadata<TeamOwnerMetadata>(owner!.user_id, { pending_upgrade: null });
                }
            }
        } else if (isProSubscription(sku)) {
            log.info(`Updating Pro user ${email} to ${JSON.stringify(userData)}`);
            await updateProUserData(email, userData);
        } else {
            throw new Error(`Webhook received for unknown subscription type: ${
                userData.subscription_sku
            } (plan ${paddleData.subscription_plan_id})`);
        }
    } else if (paddleData.alert_name === 'payment_dispute_created') {
        // If we receive a payment dispute, that means either the user has stolen somebody else's credit card,
        // and the transaction has been reported, or they've disputed their own valid payment for HTTP Toolkit
        // to avoid paying for it (and cause us major existential problems in return).
        // In either case, this is abusive behaviour, and we ban them from the app. This results in an alert
        // at startup, telling them to contact support and then insta-closing the app.
        await banUser(email);
    } else {
        log.debug(`Ignoring ${paddleData.alert_name} event`);
    }

    // Record successful checkouts in our accounting backend & metrics:
    if (paddleData.alert_name === 'subscription_created') {
        // Run actual recording asynchronously - no need to block responding to Paddle on this.
        (async () => {
            const parsedPassthrough = parseCheckoutPassthrough(paddleData.passthrough);
            const countryCode = parsedPassthrough?.country;
            await Promise.all([
                setRevenueTraits(email, {
                    "Payment provider": 'paddle',
                    "Country code": countryCode
                }),
                reportSuccessfulCheckout(parsedPassthrough?.id)
            ]);
        })().catch((e) => {
            log.warn(e);
            reportError(`Failed to record new Paddle subscription: ${e.message || e}`);
        });
    }

    // All done
    return { statusCode: 200, body: '' };
});