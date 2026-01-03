import * as crypto from 'crypto';

let idCounter = 1000;
export function id() {
    return idCounter++;
}

export function generateKeyPair() {
    return crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: {
            type: "pkcs1",
            format: 'pem'
        } as any,
        publicKeyEncoding: {
            type: "spki",
            format: 'pem'
        }
    });
}

export const keyWithoutHeaders = (key: string) => key.split('\n').slice(1, -2).join('\n');