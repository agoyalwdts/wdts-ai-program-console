import { describe, expect, it } from "vitest";
import {
  mapEnvelopeForEventType,
  mapUserAnalyticsEnvelope,
  parseWorkspaceAnalyticsJsonl,
} from "./parse-jsonl";

describe("parseWorkspaceAnalyticsJsonl", () => {
  it("parses user analytics envelope and payload", () => {
    const body = [
      JSON.stringify({
        event_id: "evt-1",
        type: "CHATGPT_USER_ANALYTICS",
        timestamp: "2026-05-27T00:00:00Z",
        workspace_id: "ws-1",
        event_date: "2026-05-27",
        user_id: "u-1",
        email: "dev@wdtablesystems.com",
        credits_used: 12.5,
        messages: 40,
      }),
    ].join("\n");

    const envs = parseWorkspaceAnalyticsJsonl(body);
    expect(envs).toHaveLength(1);
    const row = mapUserAnalyticsEnvelope(envs[0]!);
    expect(row?.user_id).toBe("u-1");
    expect(row?.credits_used).toBe(12.5);
    expect(row?.event_date).toBe("2026-05-27");
    expect(
      mapEnvelopeForEventType("CHATGPT_USER_ANALYTICS", envs[0]!)?.event_id,
    ).toBe("evt-1");
  });
});
