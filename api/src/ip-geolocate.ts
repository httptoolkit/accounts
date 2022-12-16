import fetch from 'node-fetch';

const IP_API_KEY = process.env.IP_API_KEY;
const IP_API_BASE_URL = process.env.IP_API_BASE_URL
    ?? 'https://pro.ip-api.com';

export interface IpData {
    status: 'success' | 'fail',
    message?: string,

    countryCode3: string,
    continentCode: string,
    currency: string,

    hosting: boolean,
    proxy: boolean
}

export async function getIpData(ip: string) {
    const ipData: IpData = await (await fetch(
        `${IP_API_BASE_URL}/json/${
            ip
        }?key=${IP_API_KEY}&fields=${[
            'status',
            'message',
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

    return ipData;
}