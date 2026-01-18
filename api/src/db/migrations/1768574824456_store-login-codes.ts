import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
    const { schema } = db;

    await schema.createTable('login_tokens')
        .addColumn('id', 'serial', (col) => col.primaryKey())
        .addColumn('value', 'text', (col) => col.notNull())
        .addColumn('email', 'text', (col) => col.notNull())
        .addColumn('user_ip', 'text', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
        .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
        .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
        .execute();

    await Promise.all([
        schema.createIndex('login_tokens_value_index')
            .on('login_tokens')
            .columns(['value'])
            .execute(),
        schema.createIndex('login_tokens_email_index')
            .on('login_tokens')
            .columns(['email'])
            .execute(),
    ]);
}

export async function down(db: Kysely<any>): Promise<void> {
    const { schema } = db;

    await Promise.all([
        schema.dropTable('login_tokens').execute(),
    ]);
}
