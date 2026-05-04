import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeLiteLLmLogRow } from "./normalize";
import type { LiteLLmIngestDefaults } from "./normalize";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "../../../tests/fixtures/litellm");

const defaults: LiteLLmIngestDefaults = {
  defaultProduct: "CHATGPT",
  defaultRegion: "global",
  inferCursorProduct: true,
};

describe("LiteLLM JSON fixtures", () => {
  it("normalises success-min.json", () => {
    const raw = readFileSync(path.join(fixturesDir, "success-min.json"), "utf-8");
    const row = JSON.parse(raw) as unknown;
    const r = normalizeLiteLLmLogRow(row, defaults);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.decision).toBe("ALLOWED");
    expect(r.event.sourceEventId).toBe("litellm:chatcmpl-fixture-success-1");
  });

  it("normalises failure-min.json as BLOCKED", () => {
    const raw = readFileSync(path.join(fixturesDir, "failure-min.json"), "utf-8");
    const row = JSON.parse(raw) as unknown;
    const r = normalizeLiteLLmLogRow(row, defaults);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.decision).toBe("BLOCKED");
  });
});
