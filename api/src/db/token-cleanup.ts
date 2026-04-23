import { sql } from 'kysely';
import log from 'loglevel';

import { db } from './database.ts';
import { reportError } from '../errors.ts';

const ONE_DAY = 1000 * 60 * 60 * 24;

async function deleteExpiredTokens() {
    try {
        const result = await db.deleteFrom('access_tokens')
            .where('expires_at', '<', sql<Date>`NOW() - INTERVAL '1 month'`)
            .executeTakeFirst();

        const deletedCount = Number(result.numDeletedRows);
        if (deletedCount > 0) {
            log.info(`Cleaned up ${deletedCount} expired access tokens`);
        }
    } catch (e: unknown) {
        log.error('Failed to clean up expired access tokens');
        reportError(e as Error);
    }
}

export function startTokenCleanup() {
    // Run once on startup, then daily
    deleteExpiredTokens();

    const interval = setInterval(deleteExpiredTokens, ONE_DAY);
    interval.unref();
}
