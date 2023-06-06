import { initSentry, catchErrors, reportError } from '../errors';
initSentry();

import * as querystring from 'querystring';
import moment from 'moment';
import { SubscriptionStatus } from '../../../module/src/types';

import { SKUs } from '../products';
import { recordCancellation, recordSubscription } from '../accounting';
import { mgmtClient, PayingUserMetadata } from '../auth0';
import { parseCheckoutPassthrough, reportSuccessfulCheckout, updateProUserData } from '../webhook-handling';
import {
    parsePayProCustomFields,
    PayProOrderDateFormat,
    PayProRenewalDateFormat,
    PayProWebhookData,
    validatePayProWebhook
} from '../paypro';

export const handler = catchErrors(async (event) => {
    const eventData = querystring.parse(event.body || '') as unknown as PayProWebhookData;
    console.log('Received PayPro webhook', JSON.stringify(eventData, null, 2));

    validatePayProWebhook(eventData);

    const eventType = eventData['IPN_TYPE_NAME'];

    const email = eventData.CUSTOMER_EMAIL;
    if (!email) throw new Error('Received PayPro webhook with no customer email');

    if ([
        'OrderCharged', // Initial charge for a new subscription
        'SubscriptionChargeSucceed', // Successful renewal
        'SubscriptionChargeFailed', // Failed renewal
        'SubscriptionTerminated', // Subscription permanently cancelled
        'SubscriptionSuspended' // Subscription not going to renew for now
    ].includes(eventType)) {
        console.log(`Updating user data from ${eventType} event`);

        const sku = eventData.ORDER_ITEM_SKU;
        if (!SKUs.includes(sku)) throw new Error(`Received webhook for unrecognized SKU: ${sku}`);

        const subState: SubscriptionStatus = (
            // Not active means terminated/suspended/finished, so it's definitely cancelled:
            eventData.SUBSCRIPTION_STATUS_NAME !== 'Active' ||
            // If active but 'Manual', the subscription is implicitly cancelled, so renewal is actually expiry:
            eventData.SUBSCRIPTION_RENEWAL_TYPE !== 'Auto'
        )
            ? 'deleted'
        : eventType === 'SubscriptionChargeFailed'
            ? 'past_due'
        // Status active, auto renewal, no failed charges => all good
            : 'active';

        const endDate = eventData.SUBSCRIPTION_NEXT_CHARGE_DATE
            ? moment.utc(eventData.SUBSCRIPTION_NEXT_CHARGE_DATE, PayProRenewalDateFormat)
            : undefined;
        if ((subState === 'active' || subState === 'past_due') && (!endDate || endDate.isBefore(moment()))) {
            throw new Error(`Received webhook with invalid renewal date: ${
                eventData.SUBSCRIPTION_NEXT_CHARGE_DATE
            }`);
        }

        const quantity = parseInt(eventData.PRODUCT_QUANTITY, 10);
        if (isNaN(quantity) || quantity < 1) throw new Error(`Received webhook for invalid quantity: ${quantity}`);

        const subscriptionId = eventData.SUBSCRIPTION_ID;
        if (!subscriptionId) throw new Error(`Received webhook with no subscription id`);

        await updateProUserData(email, {
            subscription_status: subState,
            subscription_sku: sku,
            subscription_quantity: quantity,
            subscription_expiry: endDate?.valueOf(),
            last_receipt_url: eventData.INVOICE_LINK,

            payment_provider: 'paypro',
            subscription_id: subscriptionId // Useful for API requests later
        });

        try {
            if (eventType === 'OrderCharged') {
                const currency = eventData.ORDER_CURRENCY_CODE;
                const price = parseFloat(eventData.ORDER_ITEM_TOTAL_AMOUNT);
                const passthroughData = parsePayProCustomFields(eventData.ORDER_CUSTOM_FIELDS).passthrough;
                const parsedPassthrough = parseCheckoutPassthrough(passthroughData);
                const countryCode = parsedPassthrough?.country;

                await Promise.all([
                    reportSuccessfulCheckout(parsedPassthrough?.id),
                    recordSubscription(email, {
                        id: subscriptionId,
                        sku,
                        currency,
                        price,
                        effectiveDate: moment.utc(eventData.ORDER_PLACED_TIME_UTC, PayProOrderDateFormat).toDate()
                    }, {
                        "Payment provider": 'paypro',
                        "Country code": countryCode
                    })
                ]).catch((e: any) => {
                    console.warn(e);
                    reportError(`Failed to record new PayPro subscription: ${e.message || e}`);
                });
            } else if (eventType === 'SubscriptionTerminated' || eventType === 'SubscriptionSuspended') {
                const existingExpiry = await getExistingSubscriptionExpiry(email).catch(console.log);

                await recordCancellation(
                    subscriptionId,
                    (existingExpiry ?? Date.now()) / 1000
                )
            }
        } catch (e: any) {
            console.log(e);
            reportError('Failed to record PayPro subscription update');
        }
    } else if (eventType === 'OrderChargedBack') {
        await updateProUserData(email, {
            subscription_status: 'deleted', // Redundant, since we should get a cancel webhook too
            subscription_expiry: Date.now(), // But we want to cancel *immediately*
            banned: true // And block the user automatically until the context support to resolve
        });
    } else {
        console.log(`Ignoring ${eventType} event`);
    }

    // All done
    return { statusCode: 200, body: '' };
});

async function getExistingSubscriptionExpiry(email: string) {
    const users = await mgmtClient.getUsersByEmail(email);
    if (users.length !== 1) throw new Error(`${users.length} users with email ${email}`);
    const user = users[0];

    return (user.app_metadata as PayingUserMetadata)?.subscription_expiry;
}