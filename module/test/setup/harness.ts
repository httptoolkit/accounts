/**
 * Test harness: Mockttp runs as a real HTTP server, src/auth.ts runs directly,
 * and sinon fake timers pin Date.now() to FIXTURE_NOW so the signed JWT
 * fixtures verify against a stable clock.
 */

import * as mockttp from 'mockttp';
import * as sinon from 'sinon';

import fixtureData from '../fixtures/jwts.json' with { type: 'json' };

import { storage } from '../../src/storage.js';
import { MOCKTTP_PORT, FIXTURE_NOW } from './ports.js';

export { expect } from 'chai';
export { storage };
export { FIXTURE_NOW };

export interface JwtFixtures {
    fixtureNow: number;
    appJwts: Record<string, string>;
    billingJwts: Record<string, string>;
    wrongAudienceAppJwt: string;
}

export const fixtures: JwtFixtures = fixtureData as JwtFixtures;

if (fixtures.fixtureNow !== FIXTURE_NOW) {
    throw new Error(
        `fixture clock (${fixtures.fixtureNow}) doesn't match the harness clock (${FIXTURE_NOW}); regenerate fixtures via \`npm run generate-test-fixtures\``
    );
}

let mockServer: mockttp.Mockttp | undefined;
let clock: sinon.SinonFakeTimers | undefined;

beforeEach(async function () {
    this.timeout(5000);
    storage.clear();
    mockServer = mockttp.getLocal();
    await mockServer.start(MOCKTTP_PORT);
    // Fake only Date; setTimeout/setInterval stay real so tests can use them
    // to let microtasks settle (e.g. getLastUserData's async re-verification).
    clock = sinon.useFakeTimers({ now: FIXTURE_NOW, toFake: ['Date'] });
});

afterEach(async function () {
    this.timeout(5000);
    clock?.restore();
    clock = undefined;
    if (mockServer) {
        await mockServer.stop();
        mockServer = undefined;
    }
});

export function getServer(): mockttp.Mockttp {
    if (!mockServer) throw new Error('mockttp not started - call from within a test');
    return mockServer;
}

export function seedTokens(tokens: {
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiry: number;
} | null): void {
    if (tokens === null) storage.removeItem('tokens');
    else storage.setItem('tokens', JSON.stringify(tokens));
}

export function seedLastJwt(jwt: string | null): void {
    if (jwt === null) storage.removeItem('last_jwt');
    else storage.setItem('last_jwt', jwt);
}

export function readStoredState(): {
    tokens: { accessToken: string; refreshToken?: string; accessTokenExpiry: number } | null;
    lastJwt: string | null;
} {
    const raw = storage.getItem('tokens');
    return {
        tokens: raw ? JSON.parse(raw) : null,
        lastJwt: storage.getItem('last_jwt')
    };
}

/**
 * Awaits a promise and returns the rejection error, or throws if the promise
 * resolves. Optionally narrows by error constructor.
 */
export async function expectRejection<T extends Error>(
    p: Promise<unknown>,
    errorClass?: new (...args: never[]) => T
): Promise<T> {
    let error: unknown;
    try {
        await p;
    } catch (e) {
        error = e;
    }
    if (error === undefined) {
        throw new Error('Expected promise to reject, but it resolved');
    }
    if (errorClass && !(error instanceof errorClass)) {
        throw new Error(
            `Expected rejection to be a ${errorClass.name}, got ${(error as Error)?.constructor?.name}: ${(error as Error)?.message}`
        );
    }
    return error as T;
}
