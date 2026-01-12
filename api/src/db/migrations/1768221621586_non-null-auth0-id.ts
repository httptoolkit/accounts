import { sql, Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('users')
        .alterColumn('auth0_user_id', (col) => col.setNotNull())
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('users')
        .alterColumn('auth0_user_id', (col) => col.dropNotNull())
        .execute();
}