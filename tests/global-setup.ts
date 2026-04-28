/**
 * Vitest globalSetup — runs once per test process before any test files are
 * loaded. Ensures the test DB exists, is migrated to the latest schema, and
 * is seeded with the deterministic synthetic dataset.
 *
 * Cost: ~1.5–2s per `npm test` invocation (the seed inserts 30 users, 103
 * licenses, 3760 usage records, 10 decisions). Acceptable; if it ever grows
 * onerous we can gate it on a "schema fingerprint" in `_prisma_migrations`.
 *
 * Sets process.env.DATABASE_URL = <test url> so all test workers connect to
 * the test DB rather than the dev DB.
 */

import { setupTestDatabase } from "./db-utils";

export default function globalSetup() {
  const { testDatabaseUrl } = setupTestDatabase({
    rootDir: process.cwd(),
    quiet: true,
  });
  process.env.DATABASE_URL = testDatabaseUrl;
}
