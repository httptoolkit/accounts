import * as _ from 'lodash';
import { Mutex } from 'async-mutex';
import { asErrorLike, CustomError } from '@httptoolkit/util';

import {
    jwtVerify,
    importSPKI,
    decodeJwt,
    JWTPayload
} from 'jose';

import { Interval, SKU, SubscriptionData, TierCode, UserAppData, UserBillingData } from "./types";
import { ACCOUNTS_API_BASE } from './util';
import { getSKUForPaddleId } from './plans';

// We read account data from the API, which includes the users
// subscription data, signed into a JWT that we can validate
// using this public key.
const USER_DATA_PUBLIC_KEY = `
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzRLZvRoiWBQS8Fdqqh/h
xVDI+ogFZ2LdIiMOQmkq2coYNvBXGX016Uw9KNlweUlCXUaQZkDuQBmwxcs80PEn
IliLvJnOcIA9bAJFEF36uIwSI/ZRj0faExanLO78cdIx+B+p69kFGlohQGzJmS1S
v/IYYu032hO+F5ypR+AoXn6qtGGLVN0zAvsvLEF3urY5jHiVbgk2FWD3FWMU3oBF
jEEjeSlAFnwJZgeEMFeYni7W/rQ8seU8y3YMIg2UyHpeVNnuWbJFFwGq8Aumg4SC
mCVpul3MYubdv034/ipGZSKJTwgubiHocrSBdeImNe3xdxOw/Mo04r0kcZBg2l/b
7QIDAQAB
-----END PUBLIC KEY-----
`.trim();
const userDataPublicKey = globalThis?.crypto?.subtle
    ? importSPKI(USER_DATA_PUBLIC_KEY, 'RS256')
    : Promise.reject(new Error('WebCrypto not available in your browser. Auth is only possible in secure contexts (HTTPS).'));


const tokenMutex = new Mutex();
let tokens:
    | { refreshToken?: string; accessToken: string; accessTokenExpiry: number; /* time in ms */ }
    | null // Initialized but not logged in
    | undefined; // Not initialized

// Synchronously load & parse the latest token value we have, if any
try {
    // ! because actually parse(null) -> null, so it's ok
    tokens = JSON.parse(localStorage.getItem('tokens')!);
} catch (e) {
    tokens = null;
    console.log('Invalid token', localStorage.getItem('tokens'), e);
}

function setTokens(newTokens: typeof tokens) {
    return tokenMutex.runExclusive(() => {
        tokens = newTokens;
        localStorage.setItem('tokens', JSON.stringify(newTokens));
    });
}

function getToken() {
    return tokenMutex.runExclusive<string | undefined>(() => {
        if (!tokens) return;

        const timeUntilExpiry = tokens.accessTokenExpiry.valueOf() - Date.now();

        // If the token is expired or close (10 mins), refresh it
        let refreshPromise = timeUntilExpiry < 1000 * 60 * 10
            ? refreshToken()
            : null;

        if (timeUntilExpiry > 1000 * 5) {
            // If the token is good for now, use it, even if we've
            // also triggered a refresh in the background
            return tokens.accessToken;
        } else {
            // If the token isn't usable, wait for the refresh
            return refreshPromise!;
        }
    });
};

export class AuthRejectedError extends CustomError {
    constructor() {
        super('Authentication failed');
    }
}

export async function sendAuthCode(email: string, source: string) {
    try {
        const response = await fetch(`${ACCOUNTS_API_BASE}/auth/send-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, source }),
        });

        if (!response.ok) {
            const body = await response.text().catch((e) =>
                `[Response body unavailable: ${asErrorLike(e).message || e}]`
            );
            throw new Error(`Unexpected ${response.status} response: ${body}`);
        }
    } catch (e) {
        throw new Error(`Failed to send auth code: ${asErrorLike(e).message || e}`);
    }
}

export async function loginWithCode(email: string, code: string) {
    try {
        const response = await fetch(`${ACCOUNTS_API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code })
        });

        if (!response.ok) {
            if (response.status === 403) {
                throw new AuthRejectedError();
            } else {
                const body = await response.text().catch((e) =>
                    `[Response body unavailable: ${asErrorLike(e).message || e}]`
                );
                throw new Error(`Unexpected ${response.status} response: ${body}`);
            }
        }

        const result = await response.json() as {
            accessToken: string,
            refreshToken: string,
            expiresAt: number
        };

        await setTokens({
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            accessTokenExpiry: result.expiresAt
        });
    } catch (e) {
        if (e instanceof AuthRejectedError) throw e;
        else throw new Error(`Failed to refresh token: ${asErrorLike(e).message || e}`);
    }
}

export function logOut() {
    setTokens(null);
}

// Must be run inside a tokenMutex. Not exported since you don't need to use it directly.
// It's used automatically when retrieving the latest user data.
async function refreshToken() {
    if (!tokens) throw new Error("Can't refresh tokens if we're not logged in");

    try {
        const response = await fetch(`${ACCOUNTS_API_BASE}/auth/refresh-token`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                refreshToken: tokens.refreshToken
            })
        });

        if (!response.ok) {
            if (response.status === 403) {
                throw new AuthRejectedError();
            } else {
                throw new Error(`Unexpected ${response.status} response when refreshing token`);
            }
        }

        const result = await response.json() as {
            accessToken: string,
            expiresAt: number
        };

        tokens!.accessToken = result.accessToken;
        tokens!.accessTokenExpiry = result.expiresAt;
        localStorage.setItem('tokens', JSON.stringify(tokens));
        return result.accessToken;
    } catch (e) {
        if (e instanceof AuthRejectedError) throw e;
        else throw new Error(`Failed to refresh token: ${asErrorLike(e).message || e}`);
    }
}

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'deleted';

interface Subscription {
    status: SubscriptionStatus;
    quantity: number;
    expiry: Date;

    sku: SKU;
    tierCode: TierCode;
    interval: Interval;
    /**
     * Preserved for backward compat - but generally we use `sku` now.
     *
     * @deprecated
     */
    plan: SKU;

    updateBillingDetailsUrl?: string;
    cancelSubscriptionUrl?: string;
    lastReceiptUrl?: string;
    canManageSubscription: boolean;
};

interface BaseAccountData {
    userId?: string;
    email?: string;
    subscription?: Subscription;
    banned: boolean;
}

export interface User extends BaseAccountData {
    featureFlags: string[];

    /**
     * This represents a subscription for which this user is the _owner_
     * but is not a _member_. The user should not be treated as having
     * an active subscription for the main tool.
     */
    teamSubscription?: Subscription;
}

const anonUser = (): User => ({ featureFlags: [], banned: false });

export interface Transaction {
    orderId: string;
    receiptUrl: string;
    sku: SKU;
    createdAt: string;
    status: string;

    currency: string;
    amount: string;
}

export interface TeamMember {
    id: string;
    name: string;
    locked: boolean;
    error?: string;
}

export interface TeamOwner {
    id: string;
    name?: string;
    error?: string;
}

export interface BillingAccount extends BaseAccountData {
    transactions: Transaction[] | null;

    // Only define if you are a member of a team:
    teamOwner?: TeamOwner;

    // Only defined if you are the owner of a team:
    teamMembers?: TeamMember[];
    lockedLicenseExpiries?: number[]; // Timestamps when locked licenses will unlock
}

const anonBillingAccount = (): BillingAccount => ({ transactions: [], banned: false });

/**
 * Synchronously gets the last received user data, _without_
 * refreshing it in any way. After 7 days without a refresh
 * though, the result will change when the JWT expires.
 */
export function getLastUserData(): User {
    try {
        const rawJwt = localStorage.getItem('last_jwt');
        const jwtData = getUnverifiedJwtPayload<UserAppData>(rawJwt);

        if (jwtData) {
            // Validate what we can synchronously:
            if (!jwtData.exp) throw new Error('Missing expiry in JWT data');
            if ((jwtData.exp * 1000) < Date.now()) throw new Error('Last JWT expired');

            // Async we do actually validate sigs etc, we just don't wait for it.
            getVerifiedJwtPayload(rawJwt, 'app').catch((e) => {
                localStorage.removeItem('last_jwt');
                console.log('Last JWT no longer valid - now cleared', e);
            });
        }

        return parseUserData(jwtData);
    } catch (e) {
        console.warn("Couldn't parse saved user data", e);
        return anonUser();
    }
}

/**
 * Get the latest valid user data we can. If possible, it loads the
 * latest data from the server. If that fails to load, or if it loads
 * but fails to parse, we return the latest user data.
 *
 * If there are no tokens available, or the latest data is expired,
 * this returns an empty (logged out) user.
 */
export async function getLatestUserData(): Promise<User> {
    try {
        const userRawJwt = await requestUserData('app');
        const jwtData = await getVerifiedJwtPayload(userRawJwt, 'app');
        const userData = parseUserData(jwtData);
        localStorage.setItem('last_jwt', userRawJwt);
        return userData;
    } catch (e) {
        try {
            // Unlike getLastUserData, this does synchronously fully validate the data
            const lastUserData = localStorage.getItem('last_jwt');
            const jwtData = await getVerifiedJwtPayload(lastUserData, 'app');
            const userData = parseUserData(jwtData);
            return userData;
        } catch (e) {
            console.warn('Failed to validate last user JWT when updating', e);
            return anonUser();
        }
    }
}

export async function getBillingData(): Promise<BillingAccount> {
    const userRawJwt = await requestUserData('billing');
    const jwtData = await getVerifiedJwtPayload(userRawJwt, 'billing');
    return parseBillingData(jwtData);
}

function getUnverifiedJwtPayload<T>(jwt: string | null): (T & JWTPayload) | null {
    if (!jwt) return null;
    return decodeJwt(jwt);
}

async function getVerifiedJwtPayload(jwt: string | null, type: 'app'): Promise<UserAppData>;
async function getVerifiedJwtPayload(jwt: string | null, type: 'billing'): Promise<UserBillingData>;
async function getVerifiedJwtPayload(jwt: string | null, type: 'app' | 'billing') {
    if (!jwt) return null;

    const decodedJwt = await jwtVerify(jwt, await userDataPublicKey, {
        algorithms: ['RS256'],
        audience: `https://httptoolkit.tech/${type}_data`,
        issuer: 'https://httptoolkit.tech/'
    });

    return decodedJwt.payload as any;
}

function parseUserData(appData: UserAppData | null): User {
    if (!appData) return anonUser();

    return {
        userId: appData.user_id,
        email: appData.email,
        subscription: parseSubscriptionData(appData),
        teamSubscription: appData.team_subscription
            ? parseSubscriptionData(appData.team_subscription)
            : undefined,
        featureFlags: appData.feature_flags || [],
        banned: !!appData.banned
    };
}

async function parseBillingData(billingData: UserBillingData | null): Promise<BillingAccount> {
    if (!billingData) return anonBillingAccount();

    const transactions = billingData.transactions?.map((transaction) => ({
        orderId: transaction.order_id,
        receiptUrl: transaction.receipt_url,
        sku: transaction.sku,
        createdAt: transaction.created_at,
        status: transaction.status,

        amount: transaction.amount,
        currency: transaction.currency
    })) ?? null; // Null => transactions timed out upstream, not available.

    return {
        email: billingData.email,
        subscription: parseSubscriptionData(billingData),
        transactions,
        teamMembers: billingData.team_members,
        teamOwner: billingData.team_owner,
        lockedLicenseExpiries: billingData.locked_license_expiries,
        banned: !!billingData.banned
    };
}

function parseSubscriptionData(rawData: SubscriptionData) {
    const sku = rawData.subscription_sku
        ?? getSKUForPaddleId(rawData.subscription_plan_id);

    const [tierCode, interval] = sku
        ? sku.split('-') as [TierCode, Interval]
        : [];

    const subscription = {
        status: rawData.subscription_status,
        plan: sku,
        sku: sku,
        tierCode,
        interval,
        quantity: rawData.subscription_quantity,
        expiry: rawData.subscription_expiry ? new Date(rawData.subscription_expiry) : undefined,
        updateBillingDetailsUrl: rawData.update_url,
        cancelSubscriptionUrl: rawData.cancel_url,
        lastReceiptUrl: rawData.last_receipt_url,
        canManageSubscription: !!rawData.can_manage_subscription
    };

    if (_.some(subscription) && !subscription.plan) {
        // No plan means no recognized plan, i.e. an unknown id. This should never happen,
        // but error reports suggest it's happened at least once.
        console.warn('Invalid raw subscription data', rawData)
        throw new CustomError('Invalid subscription data');
    }

    const optionalFields = [
        'lastReceiptUrl',
        'updateBillingDetailsUrl',
        'cancelSubscriptionUrl'
    ];

    const isCompleteSubscriptionData = _.every(
        _.omit(subscription, ...optionalFields),
        v => !_.isNil(v) // Not just truthy: canManageSubscription can be false on valid sub
    );

    // Use undefined rather than {} or partial data when there's any missing required sub fields
    return isCompleteSubscriptionData
        ? subscription as Subscription
        : undefined
}

async function requestUserData(
    type: 'app' | 'billing',
    options: { isRetry?: boolean } = {}
): Promise<string> {
    const token = await getToken();
    if (!token) return '';

    const appDataResponse = await fetch(`${ACCOUNTS_API_BASE}/get-${type}-data`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    if (!appDataResponse.ok) {
        console.log(`Received ${appDataResponse.status} loading ${type} data, with body: ${
            await appDataResponse.text()
        }`);

        if (appDataResponse.status === 401) {
            // We allow a single refresh+retry. If it's passed, we fail.
            if (options.isRetry) throw new AuthRejectedError();

            // If this is a first failure, let's assume it's a blip with our access token,
            // so a refresh is worth a shot (worst case, it'll at least confirm we're unauthed).
            return tokenMutex.runExclusive(() =>
                refreshToken()
            ).then(() =>
                requestUserData(type, { isRetry: true })
            );
        }

        throw new Error(`Failed to load ${type} data`);
    }

    return appDataResponse.text();
}

export async function updateTeamMembers(
    idsToRemove: string[],
    emailsToAdd: string[]
): Promise<void> {
    const token = await getToken();
    if (!token) throw new Error("Can't update team without an auth token");

    const appDataResponse = await fetch(`${ACCOUNTS_API_BASE}/update-team`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ idsToRemove, emailsToAdd })
    });

    if (!appDataResponse.ok) {
        const responseBody = await appDataResponse.text();
        console.log(`Received ${appDataResponse.status} updating team members: ${responseBody}`);
        throw new Error(responseBody || `Failed to update team members`);
    }
}

export async function cancelSubscription() {
    const token = await getToken();
    if (!token) throw new Error("Can't cancel account without an auth token");

    const response = await fetch(`${ACCOUNTS_API_BASE}/cancel-subscription`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    if (!response.ok) {
        throw new Error(`Unexpected ${response.status} response cancelling subscription`);
    }
}