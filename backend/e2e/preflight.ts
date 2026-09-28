// Runs before `migrate` in the E2E stack command: the migration is the first
// step that connects to DATABASE_URL, so the loopback guard has to refuse a
// shared or production target before it, not only in the seed and server.

import { assertE2eEnvironment } from './guard';

assertE2eEnvironment(process.env);
