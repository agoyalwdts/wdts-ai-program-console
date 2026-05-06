import { describe, expect, it, vi } from "vitest";
import {
  CURSOR_OVERVIEW_ADMIN_SLICE_KEYS,
  CURSOR_OVERVIEW_PANELS,
  loadCursorApiOverview,
} from "./cursor-api-overview";

const ALL_SLICE_KEYS = [
  ...CURSOR_OVERVIEW_PANELS.map((p) => p.key),
  ...CURSOR_OVERVIEW_ADMIN_SLICE_KEYS,
];

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
    for (const key of ALL_SLICE_KEYS) {
      const s = out.slices[key];
      expect(s?.status).toBe("skipped");
    }
    expect(out.aiCodeRollup.status).toBe("skipped");
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
    for (const key of CURSOR_OVERVIEW_ADMIN_SLICE_KEYS) {
      expect(out.slices[key]?.status).toBe("skipped");
    }
    expect(out.aiCodeRollup.status).toBe("skipped");
  });

  it("fetches each panel when real + key (mocked)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && u.includes("daily-usage-data")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (method === "POST" && u.includes("/teams/spend")) {
        return new Response(
          JSON.stringify({ teamMemberSpend: [], totalPages: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("/analytics/ai-code/commits")) {
        return new Response(JSON.stringify({ items: [], totalCount: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, url: u, method }), {
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
    });

    expect(out.integrationMode).toBe("real");
    expect(out.apiKeyConfigured).toBe(true);
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(CURSOR_OVERVIEW_PANELS.length + 3);
    for (const key of ALL_SLICE_KEYS) {
      expect(out.slices[key]?.status).toBe("ok");
    }
    expect(out.aiCodeRollup.status).toBe("ok");
    if (out.aiCodeRollup.status === "ok") {
      expect(out.aiCodeRollup.rollup.totals.commitCount).toBe(0);
    }
  });
});
