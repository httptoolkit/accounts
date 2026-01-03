import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import log from 'loglevel';

import type { Database } from './schema.ts';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    max: parseInt(process.env.DB_POOL_SIZE || '10', 10),

    ssl: DATABASE_URL.includes('localhost')
        ? false
        : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
    log.error('Unexpected database pool error:', err);
});

pool.on('connect', () => {
    log.debug('New database connection established');
});

export const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool })
});

export async function testConnection(db: Kysely<Database>) {
    try {
        await db.executeQuery(sql`SELECT 1`.compile(db));
    } catch (error) {
        log.error('COULD NOT CONNECT TO DATABASE');
        throw error;
    }
}

export async function closeDatabase() {
    await db.destroy();
    log.info('Database connections closed');
}