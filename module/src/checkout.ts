import { SKU } from "./types";
import { SubscriptionPlans } from "./plans";

export const openCheckout = async (
    email: string,
    planCode: SKU,
    referrer: string
) => {
    window.open(
        `https://pay.paddle.com/checkout/${
            SubscriptionPlans[planCode].id
        }?guest_email=${
            encodeURIComponent(email)
        }&referring_domain=${referrer}`,
        '_blank'
    );
}