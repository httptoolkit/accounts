// Loaded by mocha before any test file. Sets ACCOUNTS_API so that when
// src/util.ts (and src/auth.ts transitively) evaluates, ACCOUNTS_API_BASE
// already points at the mockttp server.
//
// ESM imports are hoisted within a single file, so the assignment below
// can't go in harness.ts alongside `import * as auth ...`. Keeping this
// file imports-only-of-pure-constants ensures the env is set before any
// auth-loading module is evaluated.

import { MOCK_API_BASE } from './ports.js';

process.env.ACCOUNTS_API = MOCK_API_BASE;
