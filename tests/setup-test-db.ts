/**
 * CLI entrypoint for the test-DB setup. See `tests/db-utils.ts` for what it
 * actually does.
 *
 *   npm run db:test:setup   # idempotent
 */

import { setupTestDatabase } from "./db-utils";

setupTestDatabase({ rootDir: process.cwd() });
