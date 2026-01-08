import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import log from 'loglevel';

import type { Database } from './schema.ts';
import { reportError } from '../errors.ts'

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
}
const DATABASE_CA_CERT = process.env.DATABASE_CA_CERT || false;
if (!DATABASE_CA_CERT && process.env.NODE_ENV === 'production') {
    throw new Error('No DATABASE_CA_CERT provided in production environment');
}

export let db: Kysely<Database>;

export async function initializeDbConnection() {
    const pool = new Pool({
        connectionString: DATABASE_URL,
        max: parseInt(process.env.DB_POOL_SIZE || '10', 10),

        ssl: DATABASE_CA_CERT
            ? { ca: DATABASE_CA_CERT }
            : false
    });

    pool.on('error', (err) => {
        log.error('Unexpected database pool error:', err);
    });

    pool.on('connect', () => {
        log.debug('New database connection established');
    });

    db = new Kysely<Database>({
        dialect: new PostgresDialect({ pool })
    });

    try {
        await db.executeQuery(sql`SELECT 1`.compile(db));
    } catch (error) {
        reportError('COULD NOT CONNECT TO DATABASE');
        throw error;
    }

    return db;
}

export async function closeDatabase(db: Kysely<Database>) {
    await db.destroy();
    log.info('Database connections closed');
}