import { initSentry, catchErrors } from '../errors';
initSentry();

import * as querystring from 'querystring';
import moment from 'moment';

import { PayProRenewalDateFormat, PayProWebhookData, validatePayProWebhook } from '../paypro';
import { updateProUserData } from '../webhook-handling';
import { SKUs } from '../products';

export const handler = catchErrors(async (event) => {
    const eventData = querystring.parse(event.body || '') as unknown as PayProWebhookData;
    console.log('Received PayPro webhook', JSON.stringify(eventData, null, 2));

    validatePayProWebhook(eventData);

    const eventType = eventData['IPN_TYPE_NAME'];

    const email = eventData.CUSTOMER_EMAIL;
    if (!email) throw new Error('Received PayPro webhook with no customer email');

    if ([
        'OrderCharged' // Initial charge for a new subscription
    ].includes(eventType)) {
        console.log(`Updating user data from ${eventType} event`);

        const sku = eventData.ORDER_ITEM_SKU;
        if (!SKUs.includes(sku)) throw new Error(`Received webhook for unrecognized SKU: ${sku}`);

        const endDate = moment.utc(eventData.SUBSCRIPTION_NEXT_CHARGE_DATE, PayProRenewalDateFormat);
        if (endDate.isBefore(moment())) throw new Error(`Received webhook with invalid renewal date: ${endDate}`);

        const quantity = parseInt(eventData.PRODUCT_QUANTITY, 10);
        if (isNaN(quantity) || quantity < 1) throw new Error(`Received webhook for invalid quantity: ${quantity}`);

        // If 'Manual', the subscription is implicitly cancelled straight away
        const isSubscriptionActive = eventData.SUBSCRIPTION_RENEWAL_TYPE === 'Auto';

        const userId = eventData.CUSTOMER_ID;
        if (!userId) throw new Error(`Received webhook with no customer id`);

        const subscriptionId = eventData.SUBSCRIPTION_ID;
        if (!subscriptionId) throw new Error(`Received webhook with no subscription id`);

        await updateProUserData(email, {
            subscription_status: isSubscriptionActive
                ? 'active'
                : 'deleted',
            subscription_sku: sku,
            subscription_quantity: quantity,
            subscription_expiry: endDate.valueOf(),

            payment_provider: 'paypro',
            paypro_user_id: userId,
            subscription_id: subscriptionId
        });
    } else {
        console.log(`Ignoring ${eventType} event`);
    }

    // All done
    return { statusCode: 200, body: '' };
});