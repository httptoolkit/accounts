import * as path from 'path';
import { defineConfig } from 'kysely-ctl'

export default defineConfig({
	migrations: {
		migrationFolder: path.join(__dirname, 'src', 'db', 'migrations')
	},
})
