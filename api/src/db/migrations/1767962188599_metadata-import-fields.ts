import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
	const { schema } = db;

	return schema.alterTable('users')
		.addColumn('last_ip', 'text')
		.addColumn('last_login', 'timestamptz')
		.addColumn('logins_count', 'integer', (col) => col.notNull().defaultTo(0))
		.addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.execute();
}

export async function down(db: Kysely<any>): Promise<void> {
	const { schema } = db;

	return schema.alterTable('users')
		.dropColumn('last_ip')
		.dropColumn('last_login')
		.dropColumn('logins_count')
		.dropColumn('created_at')
		.execute();
}
