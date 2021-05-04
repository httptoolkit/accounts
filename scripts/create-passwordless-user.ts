import { mgmtClient } from '../api/src/auth0';

const email = process.argv[2];
console.log(`Creating user ${email}`);

mgmtClient.createUser({
    email,
    email_verified: true,
    connection: 'email'
}).then(console.log).catch(console.error);