import fetch from 'node-fetch';
import { reportError } from './errors';

export interface ExchangeRates {
    [currency: string]: number;
}

async function getEurRates() {
    const response = await fetch("https://api.exchangerate.host/latest?base=EUR");
    const data = await response.json();
    if (!response.ok || !data.success || !data.rates) {
        console.log(JSON.stringify(data));
        throw new Error(`Unsuccessful result from exchange rate API`);
    }

    return data.rates as ExchangeRates;
}

let latestRates: Promise<ExchangeRates> | undefined;

export function getLatestEurRates() {
    // After the first successful run, we always return the latest good rates
    if (latestRates) return latestRates;

    // If there were no known rates yet, we block while getting new rates:
    latestRates = getEurRates();
    latestRates.catch((e) => {
        // If the first request fails, we reset (to try again on next
        // request) and then fail for real:
        latestRates = undefined;
        reportError(e);
        throw e;
    });

    setInterval(() => {
        // Subsequently, we try to refresh every hour, but just keep the
        // old rates indefinitely (until next refresh) if it fails:
        getEurRates()
        .then((rates) => {
            latestRates = Promise.resolve(rates);
        })
        .catch(reportError);
    }, 1000 * 60 * 60);

    return latestRates;
}