import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
	const { schema } = db;

	await schema.createTable('users')
		.addColumn('id', 'serial', (col) => col.primaryKey())
		.addColumn('auth0_user_id', 'text', (col) => col.unique())
		.addColumn('email', 'text', (col) => col.notNull().unique())
		.addColumn('app_metadata', 'jsonb', (col) => col.notNull())
		.execute();

	await Promise.all([
		schema.createIndex('user_email_index')
			.on('users')
			.columns(['email'])
			.execute(),
		schema.createIndex('user_auth0_user_id_index')
			.on('users')
			.columns(['auth0_user_id'])
			.execute(),
		schema.createIndex('user_app_metadata_subscription_owner_id_index')
			.on('users')
			.expression(sql`(app_metadata->>'subscription_owner_id')`)
			.execute()
	]);
}