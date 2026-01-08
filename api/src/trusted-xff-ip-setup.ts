import * as fs from 'fs';
import type { Application } from 'express';
import ipAddr from 'ipaddr.js';
import log from 'loglevel';

import { formatErrorMessage, reportError } from './errors.ts';

// We need to know our traffic sources to be able to know when to trust the X-Forwarded-For header,
// so that we can accurately work out the original IP source of incoming requests. We trust local
// reverse proxies and Scaleway's container proxy, but we also need to trust our CDN.

// Unfortunately Bunny (our CDN) uses IPs that may change, so we have dynamically update those.
// We handle this with a cached file generated on each container build, and a subsequent interval
// to update dynamically later on.

const TRUSTED_IP_SOURCES = [
    'loopback',
    'linklocal',
    'uniquelocal',
    '100.64.0.0/10', // Private network shared address space, used by Scaleway serverless containers
    '172.16.4.0/22'  // The subnet used by our k8s VPC
];

let bunnyCachedIPs: string[] = [];
try {
    bunnyCachedIPs.push(...(JSON.parse(fs.readFileSync('../.bunny-ipv4-ips.json', 'utf-8'))));
} catch {}
try {
    bunnyCachedIPs.push(...(JSON.parse(fs.readFileSync('../.bunny-ipv6-ips.json', 'utf-8'))));
} catch {}

async function getIPs(url: string) {
    try {
        const response = await fetch(url);

        if (!response.ok) {
            const body = response.text().catch(() => {});
            throw new Error(`Unexpected ${response.status} loading XFF IPs from ${url}:\n${body}`);
        }

        return response.json();
    } catch (e: any) {
        log.warn(e);
        throw new Error(`Unexpected ${formatErrorMessage(e)} error getting IPs from ${url}`)
    }
}

export function configureAppProxyTrust(app: Application) {
    log.info(`Loaded ${bunnyCachedIPs.length} CDN IPs from disk`);
    app.set('trust proxy', [
        ...TRUSTED_IP_SOURCES,
        ...bunnyCachedIPs.filter(ip => ipAddr.isValid(ip))
    ]);

    async function updateTrustedProxySources() {
        try {
            const [
                bunnyIPv4s,
                bunnyIPv6s
            ] = (await Promise.all<Array<string>>([
                getIPs('https://bunnycdn.com/api/system/edgeserverlist'),
                getIPs('https://bunnycdn.com/api/system/edgeserverlist/IPv6')
            ]));

            const bunnyIPs = [
                ...bunnyIPv4s,
                ...bunnyIPv6s
            ].filter(ip => ipAddr.isValid(ip));

            app.set('trust proxy', [
                ...TRUSTED_IP_SOURCES,
                ...bunnyIPv4s,
                ...bunnyIPv6s
            ]);

            log.info(`Updated to trust ${bunnyIPs.length} CDN IPs`);
        } catch (e: any) {
            log.warn(e);
            reportError(`Failed to update CDN IPs: ${e.message || e}`);
            // Retry every 5 minutes until success:
            setTimeout(updateTrustedProxySources, 1000 * 60 * 5);
        }
    }

    // On startup, and then every hour, update trusted Bunny CDN IPs:
    updateTrustedProxySources();
    setInterval(updateTrustedProxySources, 1000 * 60 * 60).unref();
}