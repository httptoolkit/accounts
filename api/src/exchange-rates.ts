import * as _ from 'lodash';
import fetch from 'node-fetch';
import * as log from 'loglevel';

import { reportError } from './errors';

const EXCHANGE_RATE_API_TOKEN = process.env.EXCHANGE_RATE_API_TOKEN;

const PRIMARY_EXCHANGE_RATE_API_BASE_URL = process.env.EXCHANGE_RATE_BASE_URL
    ?? `https://v6.exchangerate-api.com/v6/${EXCHANGE_RATE_API_TOKEN}`;

// We've had repeated issues with exchange rate sources in the past, so test a few of them in order:
const getExchangeRateSources = (currency: string) => [
    {
        // An official fully maintained exchange rate API:
        url: `${PRIMARY_EXCHANGE_RATE_API_BASE_URL}/latest/${currency}`,
        test: (data: any) => data.result === 'success',
        ratesField: 'conversion_rates'
    },
    {
        // The original repo via the CDN
        url: `https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1/latest/currencies/${currency.toLowerCase()}.json`,
        ratesField: currency.toLowerCase(),
        ratesTransform: (rates: any) => _.mapKeys(rates, (_v, k: string) => k.toUpperCase())
    },
    {
        // Same thing via different CDN
        url: `https://raw.githubusercontent.com/fawazahmed0/currency-api/1/latest/currencies/${currency.toLowerCase()}.json`,
        ratesField: currency.toLowerCase(),
        ratesTransform: (rates: any) => _.mapKeys(rates, (_v, k: string) => k.toUpperCase())
    }
]

export interface ExchangeRates {
    [currency: string]: number;
}

type SUPPORTED_TARGET_CURRENCY = 'EUR' | 'USD';

async function getRates(currency: SUPPORTED_TARGET_CURRENCY) {
    let rates: ExchangeRates | undefined = undefined;
    for (let rateSource of getExchangeRateSources(currency)) {
        const { url, test, ratesField, ratesTransform } = rateSource;
        const rateHost = new URL(url).hostname;
        log.info(`Loading exchange rates from ${rateHost}`);

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(`Unexpected error response from ${url}: ${response.status}`);
            }
            if (test && test(data) === false) {
                throw new Error(`Bad data received from ${url}: ${JSON.stringify(data)}`);
            };

            const rawRatesData = data[ratesField];
            if (!rawRatesData || !Object.keys(rawRatesData).length) {
                throw new Error(`Empty rates data received from ${url}: ${JSON.stringify(data)}`);
            }

            if (ratesTransform) {
                rates = ratesTransform(rawRatesData);
            } else {
                rates = rawRatesData;
            }

            if (rates) break;
        } catch (e: any) {
            log.error(`Lookup from ${rateHost} failed: ${e.message}`);
            reportError(e);
        }
    }

    if (rates === undefined) {
        throw new Error('Could not retrieve exchange rates from any source!');
    }

    return rates;
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

    log.info(`Doing initial ${currency} exchange rate lookup...`);

    // Otherwise, if there were no known rates yet, we block while getting new rates:
    const rateLookup = latestRates[currency] = getRates(currency)
        .catch(async (e) => {
            // If all requests fail, we reset (to try again on next request)
            // and then fail for real:
            latestRates[currency] = undefined;

            log.error(`Exchange rates lookup failed entirely with ${e.message ?? e}`);
            reportError(e);
            throw e;
        });

    const ratesUpdateInterval = setInterval(() => {
        // Subsequently, we try to refresh every hour, but just keep the
        // old rates indefinitely (until next refresh) if it fails:
        log.info(`Updating ${currency} exchange rates...`);

        getRates(currency)
        .then((rates) => {
            latestRates[currency] = Promise.resolve(rates);
        })
        .catch((e) => {
            log.warn(`Exchange rates async update failed with ${e.message ?? e}`);
            reportError(e);
        });
    }, 1000 * 60 * 60);
    ratesUpdateInterval.unref(); // We never need to block shutdown for this

    return rateLookup;
}