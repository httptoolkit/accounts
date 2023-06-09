import * as _ from 'lodash';

import { IpData } from './ip-geolocate';

interface Prices {
    'currency': string,

    'pro-monthly': number,
    'pro-annual': number,

    'team-monthly': number,
    'team-annual': number,
}

export const PRICING: { [key: string]: Prices } = {
    // Prices here attempt to balance the cost to match local developer salaries (as a benchmark
    // for both local developer and local business purchasing power), but with some tweaks to handle
    // constraints - e.g. we can't price discriminate within the EU, and individual transactions
    // can't go too low anywhere or we get burned by fixed transaction processing fees.

    // First, specific pricing with nice round numbers for the most common countries/currencies:

    'country:ARE': {
        currency: 'AED',
        'pro-monthly': 25,
        'pro-annual': 216,
        'team-monthly': 36,
        'team-annual': 324
    },

    'country:AUS': {
        currency: 'AUD',
        'pro-monthly': 14,
        'pro-annual': 120,
        'team-monthly': 22,
        'team-annual': 192
    },

    'country:BRA': {
        currency: 'BRL',
        'pro-monthly': 20,
        'pro-annual': 168,
        'team-monthly': 30,
        'team-annual': 264
    },

    'country:CAN': {
        currency: 'CAD',
        'pro-monthly': 12,
        'pro-annual': 108,
        'team-monthly': 20,
        'team-annual': 180
    },

    'country:CHE': {
        currency: 'CHF',
        'pro-monthly': 14,
        'pro-annual': 120,
        'team-monthly': 22,
        'team-annual': 192
    },

    'country:CHN': {
        currency: 'CNY',
        'pro-monthly': 32,
        'pro-annual': 264,
        'team-monthly': 50,
        'team-annual': 432
    },

    'country:CZE': {
        currency: 'CZK',
        'pro-monthly': 180,
        'pro-annual': 1608,
        'team-monthly': 280,
        'team-annual': 2568
    },

    'country:DNK': {
        currency: 'DKK',
        'pro-monthly': 55,
        'pro-annual': 480,
        'team-monthly': 85,
        'team-annual': 720
    },

    'country:GBR': {
        currency: 'GBP',
        'pro-monthly': 7,
        'pro-annual': 60,
        'team-monthly': 11,
        'team-annual': 96
    },

    'country:HKG': {
        currency: 'HKD',
        'pro-monthly': 55,
        'pro-annual': 480,
        'team-monthly': 85,
        'team-annual': 756
    },

    'country:IDN': {
        currency: 'IDR',
        'pro-monthly': 40000,
        'pro-annual': 300000,
        'team-monthly': 60000,
        'team-annual': 480000
    },

    'country:IND': {
        currency: 'INR',
        'pro-monthly': 180,
        'pro-annual': 1296,
        'team-monthly': 260,
        'team-annual': 2160
    },

    'country:ISR': {
        currency: 'ILS',
        'pro-monthly': 40,
        'pro-annual': 336,
        'team-monthly': 62,
        'team-annual': 528
    },

    'country:JPN': {
        currency: 'JPY',
        'pro-monthly': 1000,
        'pro-annual': 8400,
        'team-monthly': 1400,
        'team-annual': 13200
    },

    'country:KOR': {
        currency: 'KRW',
        'pro-monthly': 9000,
        'pro-annual': 84000,
        'team-monthly': 14000,
        'team-annual': 132000
    },

    'country:MEX': {
        currency: 'MXN',
        'pro-monthly': 80,
        'pro-annual': 672,
        'team-monthly': 116,
        'team-annual': 984
    },

    'country:RUS': {
        currency: 'RUB',
        'pro-monthly': 400,
        'pro-annual': 3600,
        'team-monthly': 600,
        'team-annual': 5400
    },

    'country:SGP': {
        currency: 'SGD',
        'pro-monthly': 10,
        'pro-annual': 84,
        'team-monthly': 14,
        'team-annual': 132
    },

    'country:SWE': {
        currency: 'SEK',
        'pro-monthly': 80,
        'pro-annual': 660,
        'team-monthly': 120,
        'team-annual': 1008
    },

    'country:TUR': {
        currency: 'TRY',
        'pro-monthly': 100,
        'pro-annual': 816,
        'team-monthly': 140,
        'team-annual': 1152
    },

    'country:UKR': {
        currency: 'UAH',
        'pro-monthly': 180,
        'pro-annual': 1512,
        'team-monthly': 260,
        'team-annual': 2256
    },

    'country:USA': {
        currency: 'USD',
        'pro-monthly': 14,
        'pro-annual': 120,
        'team-monthly': 22,
        'team-annual': 204
    },

    // Regional pricing, for countries without specific prices. Although these use generic currencies,
    // checkouts may convert them to a local currency depending on the user's settings:

    'continent:EU': { // Europe - this also doubles as our EUR benchmark price
        currency: 'EUR',
        'pro-monthly': 7,
        'pro-annual': 60,
        'team-monthly': 11,
        'team-annual': 96
    },

    'continent:AF': { // Africa
        currency: 'USD',
        'pro-monthly': 3,
        'pro-annual': 24,
        'team-monthly': 5,
        'team-annual': 36
    },

    'continent:AS': { // Asia
        currency: 'USD',
        'pro-monthly': 4,
        'pro-annual': 30,
        'team-monthly': 6,
        'team-annual': 48
    },

    'continent:NA': { // North America (but not US/Canada)
        currency: 'USD',
        'pro-monthly': 5,
        'pro-annual': 36,
        'team-monthly': 7,
        'team-annual': 60
    },

    'continent:SA': { // South America
        currency: 'USD',
        'pro-monthly': 5,
        'pro-annual': 36,
        'team-monthly': 7,
        'team-annual': 60
    },

    'continent:OC': { // Oceania
        currency: 'USD',
        'pro-monthly': 5,
        'pro-annual': 36,
        'team-monthly': 7,
        'team-annual': 60
    },

    // When all else fails, we have a fallback USD price somewhere in the middle:
    'default': {
        'currency': 'USD',
        'pro-monthly': 7,
        'pro-annual': 60,
        'team-monthly': 11,
        'team-annual': 96
    }
};

/**
 * Returns the prices for all plans available, for the given IP location.
 */
export function getAllPrices(ipData: IpData | undefined) {
    let result: Prices;

    if (!ipData) {
        result = PRICING['default'];
    } else {
        // Use the most specific pricing configuration we have:
        result = PRICING[`country:${ipData.countryCode3}`] ??
            PRICING[`continent:${ipData.continentCode}`] ??
            Object.values(PRICING).find(({ currency }) => currency === ipData!.currency) ??
            PRICING['default']
    }

    return result;
}