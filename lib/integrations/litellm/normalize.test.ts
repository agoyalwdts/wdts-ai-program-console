import { describe, expect, it } from "vitest";
import { normalizeLiteLLmLogRow, parseLiteLLmWebhookJson } from "./normalize";
import type { LiteLLmIngestDefaults } from "./normalize";

const defaults: LiteLLmIngestDefaults = {
  defaultProduct: "CHATGPT",
  defaultRegion: "global",
  inferCursorProduct: true,
};

describe("parseLiteLLmWebhookJson", () => {
  it("accepts a JSON array", () => {
    const r = parseLiteLLmWebhookJson([{ id: "1" }]);
    expect(Array.isArray(r)).toBe(true);
    if (!Array.isArray(r)) return;
    expect(r).toHaveLength(1);
  });

  it("wraps a single object", () => {
    const r = parseLiteLLmWebhookJson({ id: "x" });
    expect(Array.isArray(r)).toBe(true);
    if (!Array.isArray(r)) return;
    expect(r).toHaveLength(1);
  });
});

describe("normalizeLiteLLmLogRow", () => {
  it("normalises a logging_spec-shaped success row", () => {
    const row = {
      id: "chatcmpl-test-1",
      model: "gpt-4",
      prompt_tokens: 10,
      completion_tokens: 5,
      response_cost: 0.001,
      startTime: "2026-05-02T10:00:00.000Z",
      endTime: "2026-05-02T10:00:02.000Z",
      status: "success",
      metadata: {
        user_email: "Agoyal@wdtablesystems.com",
        wdts_product: "CODEX",
      },
    };
    const r = normalizeLiteLLmLogRow(row, defaults);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.sourceEventId).toBe("litellm:chatcmpl-test-1");
    expect(r.event.userEmail).toBe("agoyal@wdtablesystems.com");
    expect(r.event.product).toBe("CODEX");
    expect(r.event.tokensIn).toBe(10);
    expect(r.event.tokensOut).toBe(5);
    expect(r.event.costUsd).toBe(0.001);
    expect(r.event.decision).toBe("ALLOWED");
  });

  it("maps failure status to BLOCKED", () => {
    const row = {
      id: "err-1",
      model: "gpt-4",
      startTime: "2026-05-02T10:00:00.000Z",
      endTime: "2026-05-02T10:00:01.000Z",
      status: "failure",
      metadata: { user_email: "agoyal@wdtablesystems.com" },
    };
    const r = normalizeLiteLLmLogRow(row, defaults);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.decision).toBe("BLOCKED");
  });

  it("explicit wdts_product wins over Cursor-looking request_tags", () => {
    const row = {
      id: "explicit-chatgpt-1",
      model: "gpt-4",
      endTime: "2026-05-02T12:00:00.000Z",
      request_tags: ["cursor"],
      metadata: {
        user_email: "agoyal@wdtablesystems.com",
        wdts_product: "CHATGPT",
      },
    };
    const r = normalizeLiteLLmLogRow(row, defaults);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.product).toBe("CHATGPT");
  });

  it("infers CURSOR from request_tags when wdts_product is absent", () => {
    const row = {
      id: "cursor-tag-1",
      model: "gpt-4",
      endTime: "2026-05-02T12:00:00.000Z",
      request_tags: ["wdts:cursor"],
      metadata: { user_email: "agoyal@wdtablesystems.com" },
    };
    const r = normalizeLiteLLmLogRow(row, defaults);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.product).toBe("CURSOR");
  });

  it("infers CURSOR from api_base host cursor.com", () => {
    const row = {
      id: "cursor-api-1",
      model: "gpt-4",
      endTime: "2026-05-02T12:00:00.000Z",
      api_base: "https://api.cursor.com/v1",
      metadata: { user_email: "agoyal@wdtablesystems.com" },
    };
    const r = normalizeLiteLLmLogRow(row, defaults);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.product).toBe("CURSOR");
  });

  it("infers CURSOR from User-Agent in requester_custom_headers", () => {
    const row = {
      id: "cursor-ua-1",
      model: "claude-3-5-sonnet",
      endTime: "2026-05-02T12:00:00.000Z",
      metadata: {
        user_email: "agoyal@wdtablesystems.com",
        requester_custom_headers: {
          "User-Agent": "Mozilla/5.0 Cursor/0.42.0",
        },
      },
    };
    const r = normalizeLiteLLmLogRow(row, defaults);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.product).toBe("CURSOR");
  });

  it("does not infer CURSOR when LITELLM_INFER_CURSOR_PRODUCT is off", () => {
    const row = {
      id: "no-infer-1",
      model: "gpt-4",
      endTime: "2026-05-02T12:00:00.000Z",
      request_tags: ["cursor"],
      metadata: { user_email: "agoyal@wdtablesystems.com" },
    };
    const r = normalizeLiteLLmLogRow(row, {
      ...defaults,
      inferCursorProduct: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.product).toBe("CHATGPT");
  });

  it("rejects when email cannot be resolved", () => {
    const row = {
      id: "x",
      model: "gpt-4",
      endTime: "2026-05-02T10:00:00.000Z",
      metadata: {},
    };
    const r = normalizeLiteLLmLogRow(row, defaults);
    expect(r.ok).toBe(false);
  });
});
