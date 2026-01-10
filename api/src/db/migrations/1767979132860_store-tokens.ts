import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
    const { schema } = db;

    await schema.createTable('refresh_tokens')
        .addColumn('value', 'text', (col) => col.primaryKey())
        .addColumn('user_id', 'integer', (col) => col.references('users.id'))
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('last_used', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    await schema.createTable('access_tokens')
        .addColumn('value', 'text', (col) => col.primaryKey())
        .addColumn('refresh_token', 'text', (col) => col.references('refresh_tokens.value'))
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    const { schema } = db;

    await Promise.all([
        schema.dropTable('access_tokens').execute(),
        schema.dropTable('refresh_tokens').execute()
    ]);
}
