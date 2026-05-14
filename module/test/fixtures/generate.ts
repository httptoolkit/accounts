/**
 * Generates the signed JWT fixtures used by test/user-data.test.ts and
 * test/billing.test.ts.
 *
 * Requires SIGNING_PRIVATE_KEY (matching the public key baked into
 * src/auth.ts) to be set in the environment, in the same format the API
 * accepts - either:
 *   - the raw base64-encoded key body (no BEGIN/END headers), like the API's
 *     SIGNING_PRIVATE_KEY env var, or
 *   - a full PEM string (PKCS#1 `-----BEGIN RSA PRIVATE KEY-----` or
 *     PKCS#8 `-----BEGIN PRIVATE KEY-----`).
 *
 *     SIGNING_PRIVATE_KEY="$(cat /path/to/key)" \
 *         npm run generate-test-fixtures
 *
 * All fixtures are minted relative to FIXTURE_NOW (2000-01-01T00:00:00Z).
 * Tests pin Date.now() to FIXTURE_NOW via sinon fake timers, so the relative
 * timing is deterministic regardless of when the generator or the tests are
 * run. The output is fully reproducible.
 */

import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, type KeyObject } from 'node:crypto';

import { SignJWT, type JWTPayload } from 'jose';

import type { UserAppData, UserBillingData } from '../../src/types';

import { FIXTURE_NOW } from '../setup/ports';

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;

const VALID_JWT_EXPIRY = FIXTURE_NOW + YEAR;
const VALID_SUB_EXPIRY = FIXTURE_NOW + YEAR;

const FIXTURE_OUT_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'jwts.json'
);

async function signJwt(
    key: KeyObject,
    type: 'app' | 'billing',
    payload: JWTPayload,
    expiryMs: number
): Promise<string> {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer('https://httptoolkit.tech/')
        .setAudience(`https://httptoolkit.tech/${type}_data`)
        .setIssuedAt(Math.floor(FIXTURE_NOW / 1000))
        .setExpirationTime(Math.floor(expiryMs / 1000))
        .sign(key);
}

const appFixtures: Record<string, UserAppData> = {
    'app-pro-monthly': {
        user_id: 'test-user-pro-monthly',
        email: 'pro-monthly@example.invalid',
        subscription_status: 'active',
        subscription_sku: 'pro-monthly',
        subscription_quantity: 1,
        subscription_expiry: VALID_SUB_EXPIRY,
        update_url: 'https://example.invalid/update',
        cancel_url: 'https://example.invalid/cancel',
        last_receipt_url: 'https://example.invalid/receipt',
        can_manage_subscription: true
    },
    'app-team-owner': {
        user_id: 'test-user-team-owner',
        email: 'team-owner@example.invalid',
        team_subscription: {
            subscription_status: 'active',
            subscription_sku: 'team-annual',
            subscription_quantity: 5,
            subscription_expiry: VALID_SUB_EXPIRY,
            update_url: 'https://example.invalid/update',
            cancel_url: 'https://example.invalid/cancel',
            last_receipt_url: 'https://example.invalid/receipt',
            can_manage_subscription: true,
            can_update_team_size: true
        }
    },
    'app-team-member': {
        user_id: 'test-user-team-member',
        email: 'team-member@example.invalid',
        subscription_status: 'active',
        subscription_sku: 'team-annual',
        subscription_owner_id: 'test-user-team-owner',
        subscription_expiry: VALID_SUB_EXPIRY,
        subscription_quantity: 5,
        can_manage_subscription: false
    },
    'app-past-due': {
        user_id: 'test-user-past-due',
        email: 'past-due@example.invalid',
        subscription_status: 'past_due',
        subscription_sku: 'pro-monthly',
        subscription_quantity: 1,
        subscription_expiry: VALID_SUB_EXPIRY,
        update_url: 'https://example.invalid/update',
        cancel_url: 'https://example.invalid/cancel',
        last_receipt_url: 'https://example.invalid/receipt',
        can_manage_subscription: true
    },
    'app-trialing': {
        user_id: 'test-user-trialing',
        email: 'trialing@example.invalid',
        subscription_status: 'trialing',
        subscription_sku: 'pro-monthly',
        subscription_quantity: 1,
        subscription_expiry: VALID_SUB_EXPIRY,
        update_url: 'https://example.invalid/update',
        cancel_url: 'https://example.invalid/cancel',
        last_receipt_url: 'https://example.invalid/receipt',
        can_manage_subscription: true
    },
    'app-deleted-but-active': {
        // Cancelled, but paid period hasn't elapsed yet - still a valid paid user.
        user_id: 'test-user-deleted-active',
        email: 'deleted-active@example.invalid',
        subscription_status: 'deleted',
        subscription_sku: 'pro-monthly',
        subscription_quantity: 1,
        subscription_expiry: VALID_SUB_EXPIRY,
        update_url: 'https://example.invalid/update',
        cancel_url: 'https://example.invalid/cancel',
        last_receipt_url: 'https://example.invalid/receipt',
        can_manage_subscription: true
    },
    'app-banned': {
        user_id: 'test-user-banned',
        email: 'banned@example.invalid',
        banned: true
    },
    'app-legacy-paddle-id': {
        // Pre-SKU payload using the old paddle id field (550380 = pro-monthly).
        user_id: 'test-user-legacy',
        email: 'legacy@example.invalid',
        subscription_status: 'active',
        subscription_plan_id: 550380,
        subscription_quantity: 1,
        subscription_expiry: VALID_SUB_EXPIRY,
        update_url: 'https://example.invalid/update',
        cancel_url: 'https://example.invalid/cancel',
        last_receipt_url: 'https://example.invalid/receipt',
        can_manage_subscription: true
    },
    'app-feature-flags': {
        user_id: 'test-user-flags',
        email: 'flags@example.invalid',
        feature_flags: ['flag-one', 'flag-two']
    }
};

const billingFixtures: Record<string, UserBillingData> = {
    'billing-pro-with-transactions': {
        user_id: 'test-user-pro-monthly',
        email: 'pro-monthly@example.invalid',
        subscription_status: 'active',
        subscription_sku: 'pro-monthly',
        subscription_quantity: 1,
        subscription_expiry: VALID_SUB_EXPIRY,
        update_url: 'https://example.invalid/update',
        cancel_url: 'https://example.invalid/cancel',
        last_receipt_url: 'https://example.invalid/receipt',
        can_manage_subscription: true,
        transactions: [
            {
                order_id: 'order-1',
                receipt_url: 'https://example.invalid/r1',
                sku: 'pro-monthly',
                created_at: '2023-10-01T00:00:00Z',
                status: 'completed',
                currency: 'USD',
                amount: '7.00'
            },
            {
                order_id: 'order-2',
                receipt_url: 'https://example.invalid/r2',
                sku: 'pro-monthly',
                created_at: '2023-11-01T00:00:00Z',
                status: 'completed',
                currency: 'USD',
                amount: '7.00'
            }
        ]
    },
    'billing-team-owner': {
        user_id: 'test-user-team-owner',
        email: 'team-owner@example.invalid',
        subscription_status: 'active',
        subscription_sku: 'team-annual',
        subscription_quantity: 5,
        subscription_expiry: VALID_SUB_EXPIRY,
        update_url: 'https://example.invalid/update',
        cancel_url: 'https://example.invalid/cancel',
        last_receipt_url: 'https://example.invalid/receipt',
        can_manage_subscription: true,
        can_update_team_size: true,
        team_members: [
            { id: 'member-1', name: 'alice@example.invalid', locked: false },
            { id: 'member-2', name: 'bob@example.invalid', locked: true }
        ],
        locked_license_expiries: [FIXTURE_NOW + 2 * DAY],
        transactions: [
            {
                order_id: 'order-team-1',
                receipt_url: 'https://example.invalid/team-r1',
                sku: 'team-annual',
                created_at: '2023-08-01T00:00:00Z',
                status: 'completed',
                currency: 'USD',
                amount: '420.00'
            }
        ]
    },
    'billing-team-member': {
        user_id: 'test-user-team-member',
        email: 'team-member@example.invalid',
        subscription_status: 'active',
        subscription_sku: 'team-annual',
        subscription_owner_id: 'test-user-team-owner',
        subscription_expiry: VALID_SUB_EXPIRY,
        subscription_quantity: 5,
        can_manage_subscription: false,
        team_owner: { id: 'test-user-team-owner', name: 'team-owner@example.invalid' },
        transactions: null
    }
};

interface FixtureFile {
    fixtureNow: number;
    appJwts: Record<string, string>;
    billingJwts: Record<string, string>;
    // A pre-expired app JWT: exp sits 1 second before fixtureNow. Used for
    // stale last_jwt tests.
    // Signed for the billing audience but with app payload data - used to
    // verify the audience check is enforced.
    wrongAudienceAppJwt: string;
}

function loadSigningKey(raw: string): KeyObject {
    // The API stores SIGNING_PRIVATE_KEY as the raw key body (no headers); for
    // local convenience we also accept a full PEM. createPrivateKey()
    // auto-detects PKCS#1 vs PKCS#8.
    const pem = raw.includes('-----BEGIN')
        ? raw
        : `-----BEGIN RSA PRIVATE KEY-----\n${raw.trim()}\n-----END RSA PRIVATE KEY-----\n`;
    return createPrivateKey(pem);
}

async function main(): Promise<void> {
    const raw = process.env.SIGNING_PRIVATE_KEY;
    if (!raw) {
        throw new Error(
            'SIGNING_PRIVATE_KEY env var is required (the private key matching the public key in src/auth.ts, in the same form the API uses)'
        );
    }

    const key = loadSigningKey(raw);

    const appJwts: Record<string, string> = {};
    for (const [name, payload] of Object.entries(appFixtures)) {
        appJwts[name] = await signJwt(key, 'app', payload as unknown as JWTPayload, VALID_JWT_EXPIRY);
    }

    const billingJwts: Record<string, string> = {};
    for (const [name, payload] of Object.entries(billingFixtures)) {
        billingJwts[name] = await signJwt(key, 'billing', payload as unknown as JWTPayload, VALID_JWT_EXPIRY);
    }

    const wrongAudienceAppJwt = await signJwt(
        key,
        'billing',
        appFixtures["app-pro-monthly"] as unknown as JWTPayload,
        VALID_JWT_EXPIRY
    );

    const out: FixtureFile = {
        fixtureNow: FIXTURE_NOW,
        appJwts,
        billingJwts,
        wrongAudienceAppJwt
    };

    await writeFile(FIXTURE_OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
    console.log(`Wrote ${Object.keys(appJwts).length} app + ${Object.keys(billingJwts).length} billing fixtures to ${FIXTURE_OUT_PATH}`);
    console.log(`Fixtures valid until ${new Date(VALID_JWT_EXPIRY).toISOString()}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
