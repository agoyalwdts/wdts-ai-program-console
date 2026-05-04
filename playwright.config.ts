import { defineConfig, devices } from "@playwright/test";

/** Avoid clashing with `npm run dev` on 3000 — override with PLAYWRIGHT_BASE_URL. */
const port = process.env.PLAYWRIGHT_PORT ?? "3101";
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        // `output: "standalone"` — use the bundled server (see next.config.ts).
        command: "node .next/standalone/server.js",
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          PORT: port,
          HOSTNAME: "127.0.0.1",
          NODE_ENV: "production",
          // Standalone `node` does not load `.env.local`; CI sets this on the job.
          AUTH_SECRET:
            process.env.AUTH_SECRET ?? "playwright-e2e-ephemeral-secret-not-for-prod",
          // Avoid Auth.js "untrusted host" noise when probing on 127.0.0.1:PORT.
          AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST ?? "true",
        },
      },
});
