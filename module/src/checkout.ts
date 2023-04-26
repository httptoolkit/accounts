import { SKU } from "./types";
import { ACCOUNTS_API_BASE } from "./util";

const getCheckoutUrl = (email: string, sku: SKU, source: 'web' | 'app') =>
    `${ACCOUNTS_API_BASE}/redirect-to-checkout?email=${
        encodeURIComponent(email)
    }&sku=${
        sku
    }&source=app.httptoolkit.tech&returnUrl=${
        encodeURIComponent(`https://httptoolkit.com/${source}-purchase-thank-you/`)
    }`;

// Forcing an initial fetch for this URL preps the cache and speeds up the checkout
// process a little (as we can do this while we load initial user data during checkout):
export const preloadCheckout = (email: string, sku: SKU, source: 'web' | 'app') =>
    fetch(getCheckoutUrl(email, sku, source), {
        redirect: 'manual' // We just prime the API cache, we don't navigate
    }).catch(() => {}); // Just an optimization

export const goToCheckout = async (email: string, sku: SKU, source: 'web' | 'app') => {
    window.location.assign(getCheckoutUrl(email, sku, source));
}

export const openNewCheckoutWindow = async (email: string, sku: SKU, source: 'web' | 'app') => {
    window.open(getCheckoutUrl(email, sku, source), '_blank');
}