import { describe, expect, it, vi } from "vitest";
import { CURSOR_OVERVIEW_PANELS, loadCursorApiOverview } from "./cursor-api-overview";

describe("loadCursorApiOverview", () => {
  it("skips all panels when INTEGRATION_CURSOR is synthetic", async () => {
    const out = await loadCursorApiOverview({
      env: {
        INTEGRATION_CURSOR: "synthetic",
        CURSOR_TEAM_ADMIN_API_KEY: "k",
      },
    });
    expect(out.integrationMode).toBe("synthetic");
    expect(out.apiKeyConfigured).toBe(true);
    for (const p of CURSOR_OVERVIEW_PANELS) {
      const s = out.slices[p.key];
      expect(s?.status).toBe("skipped");
    }
  });

  it("skips when real mode but no API key", async () => {
    const out = await loadCursorApiOverview({
      env: {
        INTEGRATION_CURSOR: "real",
        CURSOR_TEAM_ADMIN_API_KEY: "",
        CURSOR_ADMIN_TOKEN: "",
      },
    });
    expect(out.integrationMode).toBe("real");
    expect(out.apiKeyConfigured).toBe(false);
    expect(out.slices.analyticsDau?.status).toBe("skipped");
  });

  it("fetches each panel when real + key (mocked)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      return new Response(JSON.stringify({ ok: true, url: u }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const out = await loadCursorApiOverview({
      env: {
        INTEGRATION_CURSOR: "real",
        CURSOR_TEAM_ADMIN_API_KEY: "crsr_x",
      },
      fetchImpl,
      analyticsWindow: { startDate: "7d", endDate: "today" },
    });

    expect(out.integrationMode).toBe("real");
    expect(out.apiKeyConfigured).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(CURSOR_OVERVIEW_PANELS.length);
    for (const p of CURSOR_OVERVIEW_PANELS) {
      expect(out.slices[p.key]?.status).toBe("ok");
    }
  });
});
