import { Kysely, Migrator, FileMigrationProvider } from 'kysely';
import * as path from 'path';
import * as fs from 'fs/promises';
import log from 'loglevel';

export async function runMigrations(db: Kysely<any>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations')
    })
  });

  const { error, results } = await migrator.migrateToLatest();

  results?.forEach((it) => {
    if (it.status === 'Success') {
      log.info(`DB migration "${it.migrationName}" was executed successfully`);
    } else if (it.status === 'Error') {
      log.error(`Failed to execute DB migration "${it.migrationName}"`);
    }
  });

  if (error) {
    log.error('Failed to run DB migrations:', error);
    throw error;
  }
}