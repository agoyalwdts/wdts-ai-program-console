import { describe, expect, it, vi } from "vitest";
import { registerCodexAnalyticsUserIdEmail } from "./codex-user-id-keys";
import { buildCodexAnalyticsUserEmailMap } from "./build-codex-user-email-map";

vi.mock("@/lib/integrations", () => ({
  getOpenAIClient: vi.fn(() => ({
    listCodexSeats: vi.fn(async () => [
      { userId: "openai-org:ou_abc", email: "a@wdtablesystems.com" },
    ]),
    listChatGptSeats: vi.fn(async () => [
      { userId: "ou_xyz", email: "b@wdtablesystems.com" },
    ]),
  })),
}));

describe("registerCodexAnalyticsUserIdEmail", () => {
  it("registers bare and openai-org prefixed ids", () => {
    const map = new Map<string, string>();
    registerCodexAnalyticsUserIdEmail(map, "openai-org:ou_abc", "Dev@wdts.com");
    expect(map.get("ou_abc")).toBe("dev@wdts.com");
    expect(map.get("openai-org:ou_abc")).toBe("dev@wdts.com");
  });
});

describe("buildCodexAnalyticsUserEmailMap", () => {
  it("merges codex and chatgpt org seat ids", async () => {
    const map = await buildCodexAnalyticsUserEmailMap({
      env: { INTEGRATION_OPENAI: "real", INTEGRATION_OPENAI_COMPLIANCE: "synthetic" },
    });
    expect(map.get("ou_abc")).toBe("a@wdtablesystems.com");
    expect(map.get("ou_xyz")).toBe("b@wdtablesystems.com");
    expect(map.get("openai-org:ou_xyz")).toBe("b@wdtablesystems.com");
  });
});
