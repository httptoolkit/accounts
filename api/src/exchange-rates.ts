import fetch from 'node-fetch';
import { reportError } from './errors';

const EXCHANGE_RATE_BASE_URL = process.env.EXCHANGE_RATE_BASE_URL
    ?? "https://api.exchangerate.host";

export interface ExchangeRates {
    [currency: string]: number;
}

type SUPPORTED_TARGET_CURRENCY = 'EUR' | 'USD';

async function getRates(currency: SUPPORTED_TARGET_CURRENCY) {
    console.log(`Updating ${currency} exchange rates`);
    const response = await fetch(`${EXCHANGE_RATE_BASE_URL}/latest?base=${currency}`);
    const data = await response.json();
    if (!response.ok || !data.success || !data.rates || !Object.keys(data.rates).length) {
        console.log(response.status, JSON.stringify(data));
        throw new Error(`Unsuccessful result from exchange rate API`);
    }

    return data.rates as ExchangeRates;
}

let latestRates: {
    [C in SUPPORTED_TARGET_CURRENCY]?: Promise<ExchangeRates>
} = {};

export function getLatestRates(currency: SUPPORTED_TARGET_CURRENCY) {
    // After the first successful run, we always return the latest good rates
    const lastRates = latestRates[currency];
    if (lastRates) return lastRates;

    // Otherwise, if there were no known rates yet, we block while getting new rates:
    const rateLookup = getRates(currency);
    latestRates[currency] = rateLookup;
    rateLookup.catch((e) => {
        // If the first request fails, we reset (to try again on next
        // request) and then fail for real:
        latestRates[currency] = undefined;
        console.warn(`Exchange rates initial lookup failed with ${e.message ?? e}`);
        reportError(e);
    });

    const ratesUpdateInterval = setInterval(() => {
        // Subsequently, we try to refresh every hour, but just keep the
        // old rates indefinitely (until next refresh) if it fails:
        getRates(currency)
        .then((rates) => {
            latestRates[currency] = Promise.resolve(rates);
        })
        .catch((e) => {
            console.warn(`Exchange rates async update failed with ${e.message ?? e}`);
            reportError(e);
        });
    }, 1000 * 60 * 60);
    ratesUpdateInterval.unref(); // We never need to block shutdown for this

    return rateLookup;
}