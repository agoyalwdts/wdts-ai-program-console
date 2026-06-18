import { describe, expect, it } from "vitest";
import {
  OPENAI_VENDOR_SYNC_CHUNK_DAYS,
  openAiVendorBackfillChunks,
  openAiVendorSyncWindowMs,
} from "./openai-vendor-sync-windows";

describe("openAiVendorSyncWindowMs", () => {
  it("computes inclusive window from lookback and offset", () => {
    const nowMs = Date.UTC(2026, 5, 18, 12, 0, 0);
    const { startMs, endMs } = openAiVendorSyncWindowMs({
      lookbackDays: 7,
      endOffsetDays: 0,
      nowMs,
    });
    expect(endMs).toBe(nowMs);
    expect(endMs - startMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("openAiVendorBackfillChunks", () => {
  it("covers 120d in 31d chunks newest-first", () => {
    const chunks = openAiVendorBackfillChunks(120, OPENAI_VENDOR_SYNC_CHUNK_DAYS);
    expect(chunks[0]).toEqual({ endOffsetDays: 0, lookbackDays: 31 });
    expect(chunks.length).toBeGreaterThan(3);
    const span = chunks.reduce((acc, c) => acc + c.lookbackDays, 0);
    expect(span).toBe(120);
  });
});
