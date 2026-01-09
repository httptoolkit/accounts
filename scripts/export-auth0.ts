#!./node_modules/.bin/tsx

import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const DOMAIN = process.env.AUTH0_DOMAIN;
const CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID;
const CLIENT_SECRET = process.env.AUTH0_MGMT_CLIENT_SECRET;
const OUTPUT_FILE = './auth0_users.json';

if (!DOMAIN || !CLIENT_ID || !CLIENT_SECRET) {
    console.error('Missing required environment variables.');
    process.exit(1);
}

async function getAccessToken() {
    const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        audience: `https://${DOMAIN}/api/v2/`
    });

    const res = await fetch(`https://${DOMAIN}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params
    });

    if (!res.ok) throw new Error(`Token failed: ${res.statusText}`);
    const data = await res.json() as { access_token: string };
    return data.access_token;
}

async function triggerExport(token: string) {
    console.log('Triggering export job...');
    const res = await fetch(`https://${DOMAIN}/api/v2/jobs/users-exports`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            format: 'json',
            fields: [
                { name: 'user_id' },
                { name: 'email' },
                { name: 'app_metadata' },
                { name: 'last_ip' },
                { name: 'last_login' },
                { name: 'created_at' },
                { name: 'logins_count' }
            ]
        })
    });

    if (!res.ok) throw new Error(`Export trigger failed: ${res.statusText}`);
    const data = await res.json() as { id: string };
    return data.id;
}

async function waitForJob(token: string, jobId: string) {
    console.log(`Polling job ${jobId}...`);

    while (true) {
        const res = await fetch(`https://${DOMAIN}/api/v2/jobs/${jobId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error(`Polling failed: ${res.statusText}`);

        const job = await res.json() as { status: string; location?: string };

        if (job.status === 'completed' && job.location) {
            return job.location;
        } else if (job.status === 'failed') {
            throw new Error('Export job failed via Auth0.');
        }

        await new Promise(r => setTimeout(r, 2000));
    }
}

async function downloadAndExtract(url: string) {
    console.log('Downloading and extracting...');
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.statusText}`);

    await pipeline(
        res.body as any,
        createGunzip(),
        createWriteStream(OUTPUT_FILE)
    );

    console.log(`Saved to ${OUTPUT_FILE}`);
}

(async () => {
    try {
        const token = await getAccessToken();
        const jobId = await triggerExport(token);
        const downloadUrl = await waitForJob(token, jobId);
        await downloadAndExtract(downloadUrl);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
})();