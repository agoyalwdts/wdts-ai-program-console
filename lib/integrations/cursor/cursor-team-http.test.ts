import { describe, expect, it, vi } from "vitest";
import { IntegrationError } from "../errors";
import { cursorTeamGetJson } from "./cursor-team-http";

describe("cursorTeamGetJson", () => {
  it("GETs api.cursor.com with Basic auth and returns JSON", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(
        "https://api.cursor.com/analytics/team/dau?startDate=7d&endDate=today",
      );
      return new Response(JSON.stringify({ data: [{ dau: 3 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const body = await cursorTeamGetJson({
      path: "/analytics/team/dau",
      query: { startDate: "7d", endDate: "today" },
      apiKey: "crsr_test",
      fetchImpl,
    });
    expect(body).toEqual({ data: [{ dau: 3 }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Basic ${Buffer.from("crsr_test:").toString("base64")}`,
    );
  });

  it("throws IntegrationError on non-JSON body", async () => {
    const fetchImpl = vi.fn(async () => new Response("not json", { status: 200 })) as typeof fetch;
    await expect(
      cursorTeamGetJson({
        path: "/v1/me",
        apiKey: "k",
        fetchImpl,
      }),
    ).rejects.toThrow(IntegrationError);
  });
});
