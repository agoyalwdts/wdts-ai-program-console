import { test, expect } from "@playwright/test";

test("GET /api/health returns ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { ok?: boolean; service?: string };
  expect(body.ok).toBe(true);
  expect(typeof body.service).toBe("string");
});
