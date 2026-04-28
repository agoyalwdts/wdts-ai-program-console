/**
 * Helpers for the Vitest test-DB story (scoping §9.2).
 *
 * The test DB is a separate Postgres database on the same instance as the
 * dev DB, named `<dev-db-name>_test`. It's created by `npm run db:test:setup`
 * and is reset to the deterministic synthetic seed every run.
 *
 * Constraints that callers must respect:
 *   - Tests against this DB MUST be read-only. Vitest runs test files in
 *     parallel; a write would race other workers.
 *   - If you need a write-path test, wrap the write in `$transaction(async
 *     (tx) => { ...; throw new Rollback() })` and discard the rollback so
 *     the row never commits, OR add per-test isolation in a v0.3 PR.
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export function loadDevDatabaseUrl(rootDir: string): string {
  // We don't depend on dotenv here so the helper stays usable from a script
  // that runs before any other module is loaded. .env is small.
  const envPath = path.join(rootDir, ".env");
  if (!existsSync(envPath)) {
    throw new Error(
      `Cannot find .env at ${envPath}. The test DB infra reads DATABASE_URL ` +
        `from it to derive the test DB name.`,
    );
  }
  const txt = readFileSync(envPath, "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*"?([^"\s#]+)"?\s*$/);
    if (m) return m[1]!;
  }
  throw new Error(`No DATABASE_URL in ${envPath}`);
}

export function deriveTestDatabaseUrl(databaseUrl: string): string {
  const u = new URL(databaseUrl);
  const dbName = u.pathname.replace(/^\/+/, "");
  if (!dbName) {
    throw new Error(`DATABASE_URL has no database name: ${databaseUrl}`);
  }
  u.pathname = `/${dbName}_test`;
  return u.toString();
}

function adminUrl(databaseUrl: string): string {
  // psql doesn't recognise Prisma-specific query params like `schema=public`
  // and aborts with status 2 if they're present. Strip the search part.
  const u = new URL(databaseUrl);
  u.pathname = "/postgres";
  u.search = "";
  return u.toString();
}

export function ensureTestDatabaseExists(devUrl: string): void {
  const testUrl = deriveTestDatabaseUrl(devUrl);
  const dbName = new URL(testUrl).pathname.replace(/^\//, "");
  const admin = adminUrl(devUrl);
  // -tA = tuples-only, unaligned. Idempotent existence check.
  const existing = execSync(
    `psql "${admin}" -tA -c "SELECT 1 FROM pg_database WHERE datname='${dbName}'"`,
    { stdio: ["ignore", "pipe", "inherit"] },
  )
    .toString()
    .trim();
  if (existing === "1") return;
  execSync(`psql "${admin}" -c 'CREATE DATABASE "${dbName}"'`, {
    stdio: ["ignore", "pipe", "inherit"],
  });
}

export function setupTestDatabase(opts: { rootDir: string; quiet?: boolean }): {
  testDatabaseUrl: string;
} {
  const log = opts.quiet ? () => {} : (m: string) => console.log(m);
  const devUrl = loadDevDatabaseUrl(opts.rootDir);
  const testUrl = deriveTestDatabaseUrl(devUrl);
  log(`[test-db] target: ${new URL(testUrl).pathname.replace(/^\//, "")}`);

  ensureTestDatabaseExists(devUrl);

  const env = { ...process.env, DATABASE_URL: testUrl };
  execSync("npx prisma migrate deploy", {
    stdio: opts.quiet ? "pipe" : "inherit",
    cwd: opts.rootDir,
    env,
  });
  execSync("npx prisma db seed", {
    stdio: opts.quiet ? "pipe" : "inherit",
    cwd: opts.rootDir,
    env,
  });
  log("[test-db] migrations applied + seed loaded");
  return { testDatabaseUrl: testUrl };
}
