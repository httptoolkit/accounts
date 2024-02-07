import NodeCache from 'node-cache';
import fetch from 'node-fetch';
import * as log from 'loglevel';

import { reportError } from './errors';

const IP_API_KEY = process.env.IP_API_KEY;
const IP_API_BASE_URL = process.env.IP_API_BASE_URL
    ?? 'https://pro.ip-api.com';

interface IpApiResponse {
    status: 'success' | 'fail',
    message?: string,

    countryCode: string,
    countryCode3: string,
    continentCode: string,
    currency: string,

    hosting: boolean,
    proxy: boolean
}

export interface IpData {
    countryCode: string,
    countryCode3: string,
    continentCode: string,
    currency: string,

    hosting: boolean,
    proxy: boolean
}

// We cache IP data, to make this more reliable, to avoid overloading IP lookup
// services, and to help with UX. IP results changing affects prices, and nobody
// wants prices to change between the pricing page and the checkout.
// No hard guarantees in all edge cases, as this process will be distributed,
// servers may restart, and new deploys or connection issues can affect
// prices elsewhere, but actively caching results makes this _fairly_ reliable.
const ipCache = new NodeCache({
    stdTTL: 60 * 60 // Cached for 6h
});

export async function getIpData(ip: string | undefined, retries = 2) {
    if (!ip) {
        reportError('No client IP data available');
        return undefined;
    }
    if (ipCache.has(ip)) return ipCache.get(ip) as IpData;

    try {
        const ipData: IpApiResponse = await (await fetch(
            `${IP_API_BASE_URL}/json/${
                ip
            }?key=${IP_API_KEY}&fields=${[
                'status',
                'message',
                'countryCode',
                'countryCode3',
                'continentCode',
                'currency',
                'proxy',
                'hosting'
            ].join(',')}`
        )).json();

        if (ipData.status !== 'success') {
            throw new Error(`Failure from IP API: ${ipData.message}`);
        }

        ipCache.set(ip, ipData);
        return ipData;
    } catch (e: any) {
        if (retries > 0) {
            log.warn(e);
            return getIpData(ip, retries - 1);
        }

        reportError(e);
        return undefined;
    }
}