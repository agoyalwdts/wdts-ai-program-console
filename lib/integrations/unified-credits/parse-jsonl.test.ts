import { describe, expect, it } from "vitest";
import { mapCostsEnvelope, parseUnifiedCreditsJsonl } from "./parse-jsonl";

describe("unified-credits parse-jsonl", () => {
  it("maps COSTS envelope with identity and billing credits", () => {
    const [env] = parseUnifiedCreditsJsonl(
      JSON.stringify({
        event_id: "evt-1",
        type: "COSTS",
        timestamp: "2026-06-10T13:59:59Z",
        payload: {
          day: "2026-06-10",
          hour: 13,
          identity: { user_id: "user-1", email: "ada@wdtablesystems.com", name: "Ada" },
          product: "chatgpt",
          model: "gpt-5.5",
          measures: {
            billing: [
              {
                sku: "chat.completion.5.reasoning",
                cost: { value: 5, unit: "CREDITS" },
              },
            ],
          },
        },
      }),
    );
    expect(env).toBeDefined();
    const row = mapCostsEnvelope(env!);
    expect(row?.day).toBe("2026-06-10");
    expect(row?.hour).toBe(13);
    expect(row?.email).toBe("ada@wdtablesystems.com");
    expect(row?.credits_total).toBe(5);
    expect(row?.product).toBe("chatgpt");
  });

  it("maps codex product rows", () => {
    const row = mapCostsEnvelope({
      event_id: "evt-2",
      type: "COSTS",
      payload: {
        day: "2026-06-11",
        hour: 2,
        identity: { email: "dev@wdtablesystems.com" },
        product: "codex",
        measures: {
          billing: [{ sku: "codex.default", cost: { value: 12, unit: "CREDITS" } }],
        },
      },
    });
    expect(row?.product).toBe("codex");
    expect(row?.credits_total).toBe(12);
  });
});
