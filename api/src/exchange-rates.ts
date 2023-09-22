import * as _ from 'lodash';
import fetch from 'node-fetch';
import { reportError } from './errors';

const EXCHANGE_RATE_BASE_URL = process.env.EXCHANGE_RATE_BASE_URL
    ?? "https://api.exchangerate.host";

const EXCHANGE_RATE_BACKUP_URL = process.env.EXCHANGE_RATE_BACKUP_URL
    ?? "https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1/latest/currencies/";

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

async function getBackupRates(currency: SUPPORTED_TARGET_CURRENCY) {
    console.log(`Updating ${currency} exchange rates from backup source`);
    const response = await fetch(`${EXCHANGE_RATE_BACKUP_URL}/${currency.toLowerCase()}.json`);
    const data = await response.json();

    const rates = data?.[currency.toLowerCase()];

    if (!response.ok || !rates || !Object.keys(rates).length) {
        console.log(response.status, JSON.stringify(data));
        throw new Error(`Unsuccessful result from exchange rate backup API`);
    }

    return _.mapKeys(rates, (v, k: string) => k.toUpperCase()) as ExchangeRates;

}

// We cache the latest result here (either a promise for the very first result, or an already
// resolved promise for the last successful result).
let latestRates: {
    [C in SUPPORTED_TARGET_CURRENCY]?: Promise<ExchangeRates>
} = {};

export function getLatestRates(currency: SUPPORTED_TARGET_CURRENCY) {
    // After the first successful run, we always return the latest good rates
    const lastRates = latestRates[currency];
    if (lastRates) return lastRates;

    // Otherwise, if there were no known rates yet, we block while getting new rates:
    const rateLookup = getRates(currency);
    rateLookup.catch(async (e) => {
        console.warn(`Exchange rates initial lookup failed with ${e.message ?? e}`);
        reportError(e);
    });

    const rateLookupWithBackup = rateLookup.catch(() => {
        // Same again, from the backup source:
        const backupRateLookup = getBackupRates(currency);
        backupRateLookup.catch((e) => {
            // If both requests fail, we reset (to try again on next request) and
            // then fail for real:
            latestRates[currency] = undefined;
            console.error(e);
            reportError(`Backup exchange rate source failed! ${e.message}`);
        });
        return backupRateLookup;
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

    latestRates[currency] = rateLookupWithBackup;
    return rateLookupWithBackup;
}