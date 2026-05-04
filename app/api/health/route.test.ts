import { describe, expect, it } from "vitest";

async function importRoute() {
  return await import("./route");
}

describe("GET /api/health", () => {
  it("returns ok and service name", async () => {
    const { GET } = await importRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("wdts-ai-program-console");
  });
});
