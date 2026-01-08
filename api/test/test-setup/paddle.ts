import * as path from 'path';
import { getLocal } from 'mockttp';

import { id } from './utils.ts';

import { PaddleTransaction } from '../../src/paddle.ts';

export const PADDLE_PORT = 9092;
process.env.PADDLE_BASE_URL = `http://localhost:${PADDLE_PORT}`;

export const paddleServer = getLocal({
    https: {
        keyPath: path.join(import.meta.dirname, '..', 'fixtures', 'test-ca.key'),
        certPath: path.join(import.meta.dirname, '..', 'fixtures', 'test-ca.pem'),
        keyLength: 2048
    }
});

export async function givenPaddleSubscription(subId: number) {
    const userId = id();

    await paddleServer
        .forPost(`/api/2.0/subscription/users`)
        .withForm({
            subscription_id: subId.toString()
        })
        .thenJson(200, {
            success: true,
            response: [{ user_id: userId.toString() }]
        });

    return { paddleUserId: userId };
}

export function givenPaddleTransactions(userId: number, transactions: PaddleTransaction[]) {
    return paddleServer
        .forPost(`/api/2.0/user/${userId}/transactions`)
        .thenJson(200, {
            success: true,
            response: transactions
        });
}
