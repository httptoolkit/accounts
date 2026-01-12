import { sql, Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
    await sql`CREATE EXTENSION IF NOT EXISTS citext`.execute(db)

    await db.schema
        .alterTable('users')
        .alterColumn('email', (col) => col.setDataType(sql`citext`))
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema
        .alterTable('users')
        .alterColumn('email', (col) => col.setDataType('text'))
        .execute();

    await sql`DROP EXTENSION IF EXISTS citext`.execute(db);
}