import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

const DB_NAME = 'test_db';
const DB_PORT = 5445;

console.log('Starting test DB...');

let postgres = new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase(DB_NAME)
    .withUsername('user')
    .withPassword('password')
    .withExposedPorts({ container: 5432, host: DB_PORT })
    .start()
.then((startedContainer) => {
    console.log('DB started');
    return startedContainer;
}).catch((err) => {
    console.error('Failed to start test DB container:', err);
    process.exit(1);
});

process.env.DATABASE_URL = `postgresql://user:password@localhost:${DB_PORT}/${DB_NAME}`;

before(async function () {
    this.timeout(20000);
    await postgres;
});

after(async () => {
    const db = await postgres;
    await db.stop();
});

export async function truncateAllTables() {
    const maintenanceDb = new Kysely<any>({
        dialect: new PostgresDialect({
            pool: new Pool({
                connectionString: process.env.DATABASE_URL!,
                max: 1
            }),
        }),
    });

    try {
        const tables = await maintenanceDb.introspection.getTables();

        const tableNames = tables
            .map((t) => t.name)
            .filter((name) => !name.includes('kysely_migration'))
            .map((name) => `"${name}"`)
            .join(', ');

        if (tableNames.length > 0) {
            await sql`TRUNCATE TABLE ${sql.raw(tableNames)} CASCADE`.execute(maintenanceDb);
        }
    } finally {
        await maintenanceDb.destroy();
    }
}

beforeEach(() => truncateAllTables());