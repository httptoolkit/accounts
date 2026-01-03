import { createUser } from '../api/src/user-data-facade';

const email = process.argv[2];
console.log(`Creating user ${email}`);

createUser(email).then(console.log).catch(console.error);