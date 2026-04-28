/**
 * Vitest setup file — runs in every test worker before tests load. Resolves
 * the test DB URL and overrides process.env.DATABASE_URL before
 * `@/lib/prisma` (or any module that touches it) is imported.
 *
 * This must run in the worker, not just globalSetup, because Vitest's
 * globalSetup runs in a separate process and its env mutations don't
 * propagate to workers.
 */

import { deriveTestDatabaseUrl, loadDevDatabaseUrl } from "./db-utils";

process.env.DATABASE_URL = deriveTestDatabaseUrl(loadDevDatabaseUrl(process.cwd()));
