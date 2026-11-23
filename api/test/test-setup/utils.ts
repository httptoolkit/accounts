import * as crypto from 'crypto';
import type { MockedEndpoint } from 'mockttp';
import { delay } from '@httptoolkit/util';

let idCounter = 1000;
export function id() {
    return idCounter++;
}

// Waits for requests that the API sends in the background, after responding. Resolves with
// the requests seen so far after the timeout, so the caller's assertions report any mismatch.
export async function waitForRequests(endpoint: MockedEndpoint, count: number, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    let requests = await endpoint.getSeenRequests();
    while (requests.length < count && Date.now() < deadline) {
        await delay(5);
        requests = await endpoint.getSeenRequests();
    }
    return requests;
}

export function generateKeyPair() {
    return crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: {
            type: "pkcs1",
            format: 'pem'
        },
        publicKeyEncoding: {
            type: "spki",
            format: 'pem'
        }
    });
}

export const keyWithoutHeaders = (key: string) => key.split('\n').slice(1, -2).join('\n');