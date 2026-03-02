#!./node_modules/.bin/tsx

import { closeDatabase, initializeDbConnection } from '../api/src/db/database';
import { createUser } from '../api/src/user-data-facade';

const email = process.argv[2];

(async () => {
    const db = await initializeDbConnection();
    await createUser(email);
    console.log(`User ${email} created`);
    await closeDatabase(db);
})();