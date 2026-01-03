import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
	const { schema } = db;

	await schema.createTable('users')
		.addColumn('id', 'serial', (col) => col.primaryKey())
		.addColumn('auth0_user_id', 'text', (col) => col.unique())
		.addColumn('email', 'text', (col) => col.notNull())
		.addColumn('app_metadata', 'jsonb', (col) => col.notNull())
		.execute();
}