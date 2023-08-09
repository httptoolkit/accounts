import { SKU } from "./types";
import { ACCOUNTS_API_BASE } from "./util";

const getCheckoutUrl = (email: string, sku: SKU, source: 'web' | 'app') =>
    `${ACCOUNTS_API_BASE}/redirect-to-checkout?email=${
        encodeURIComponent(email)
    }&sku=${
        sku
    }&source=${window.location.hostname}&returnUrl=${
        encodeURIComponent(`https://httptoolkit.com/${source}-purchase-thank-you/`)
    }`;


// Create a link rel=prefetch (preloading a navigation) for a URL we're likely to open very shortly.
function prefetchPage(url: string) {
    const linkExists = !!document.head.querySelector(`link[href='${url}'][rel=prefetch]`);
    if (linkExists) return;

    const prerenderLink = document.createElement("link");
    prerenderLink.setAttribute("rel", "prefetch");
    prerenderLink.setAttribute("href", url);
    document.head.appendChild(prerenderLink);
}

/**
 * Forcing an initial fetch for this URL preps the server cache and speeds up the checkout
 * process a little (as we can do this while we load initial user data during checkout).
 *
 * This makes sense only when the real navigation will be in another context (e.g. the
 * system browser, when running in Electron). Otherwise prefetchCheckout does the same
 * thing server-side but helpfully also caches in the browser too.
 */
export function prepareCheckout(email: string, sku: SKU, source: 'web' | 'app') {
    fetch(getCheckoutUrl(email, sku, source), {
        redirect: 'manual' // We just prime the API cache, we don't navigate
    }).catch(() => {}); // Just an optimization - ignore errors

    return; // We don't return the promise - don't wait for this, just trigger it
};

/**
 * Prefetch the checkout, using a prefetch link in the HEAD. This should be used before
 * loading the checkout in the same context. If loading it elsewhere (the system browser)
 * then prepareCheckout should be used instead.
 */
export function prefetchCheckout(email: string, sku: SKU, source: 'web' | 'app') {
    prefetchPage(getCheckoutUrl(email, sku, source));
}

export async function goToCheckout(email: string, sku: SKU, source: 'web' | 'app') {
    window.location.assign(getCheckoutUrl(email, sku, source));
}

export function openNewCheckoutWindow(email: string, sku: SKU, source: 'web' | 'app') {
    window.open(getCheckoutUrl(email, sku, source), '_blank');
};