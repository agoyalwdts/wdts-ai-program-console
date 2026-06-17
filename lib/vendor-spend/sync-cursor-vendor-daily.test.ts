import { describe, expect, it } from "vitest";
import {
  CURSOR_VENDOR_DEFAULT_BACKFILL_DAYS,
  CURSOR_VENDOR_SYNC_CHUNK_DAYS,
  cursorVendorBackfillChunks,
  cursorVendorSyncWindowMs,
} from "./cursor-vendor-sync-windows";

describe("cursorVendorSyncWindowMs", () => {
  const nowMs = Date.UTC(2026, 5, 10, 12, 0, 0);

  it("defaults to last 7 days ending now", () => {
    const w = cursorVendorSyncWindowMs({ lookbackDays: 7, nowMs });
    expect(w.endOffsetDays).toBe(0);
    expect(w.endMs).toBe(nowMs);
    expect(w.startMs).toBe(nowMs - 7 * 86_400_000);
  });

  it("offsets window end for older chunks", () => {
    const w = cursorVendorSyncWindowMs({ lookbackDays: 7, endOffsetDays: 7, nowMs });
    expect(w.endMs).toBe(nowMs - 7 * 86_400_000);
    expect(w.startMs).toBe(nowMs - 14 * 86_400_000);
  });
});

describe("cursorVendorBackfillChunks", () => {
  it("covers 90 days in 7-day chunks", () => {
    const chunks = cursorVendorBackfillChunks(90, CURSOR_VENDOR_SYNC_CHUNK_DAYS);
    expect(chunks).toHaveLength(13);
    expect(chunks[0]).toEqual({ endOffsetDays: 0, lookbackDays: 7 });
    expect(chunks[12]).toEqual({ endOffsetDays: 84, lookbackDays: 6 });
  });

  it("defaults to 90-day backfill constant", () => {
    const chunks = cursorVendorBackfillChunks(CURSOR_VENDOR_DEFAULT_BACKFILL_DAYS);
    expect(chunks.length).toBeGreaterThan(1);
    const span = chunks.reduce((max, c) => Math.max(max, c.endOffsetDays + c.lookbackDays), 0);
    expect(span).toBe(90);
  });
});
