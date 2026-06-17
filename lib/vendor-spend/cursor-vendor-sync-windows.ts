/** Incremental cron + manual refresh window (App Service HTTP timeout). */
export const CURSOR_VENDOR_SYNC_CHUNK_DAYS = 7;

/** Max single admin/cron request lookback (non-chunked). */
export const CURSOR_VENDOR_MANUAL_MAX_LOOKBACK_DAYS = 30;

/** Max total history for chunked backfill. */
export const CURSOR_VENDOR_MAX_BACKFILL_DAYS = 120;

/** Default Settings / GHA backfill depth. */
export const CURSOR_VENDOR_DEFAULT_BACKFILL_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type CursorVendorSyncChunk = {
  endOffsetDays: number;
  lookbackDays: number;
};

/** Window ending `endOffsetDays` ago: [now - endOffset - lookback, now - endOffset]. */
export function cursorVendorSyncWindowMs(args: {
  lookbackDays: number;
  endOffsetDays?: number;
  nowMs?: number;
}): { startMs: number; endMs: number; lookbackDays: number; endOffsetDays: number } {
  const endOffsetDays = Math.max(0, args.endOffsetDays ?? 0);
  const lookbackDays = Math.min(Math.max(args.lookbackDays, 1), 400);
  const nowMs = args.nowMs ?? Date.now();
  const endMs = nowMs - endOffsetDays * MS_PER_DAY;
  const startMs = endMs - lookbackDays * MS_PER_DAY;
  return { startMs, endMs, lookbackDays, endOffsetDays };
}

/** Non-overlapping chunks covering the last `totalLookbackDays` (newest first). */
export function cursorVendorBackfillChunks(
  totalLookbackDays: number,
  chunkDays: number = CURSOR_VENDOR_SYNC_CHUNK_DAYS,
): CursorVendorSyncChunk[] {
  const total = Math.min(
    Math.max(Math.floor(totalLookbackDays), 1),
    CURSOR_VENDOR_MAX_BACKFILL_DAYS,
  );
  const chunk = Math.min(Math.max(Math.floor(chunkDays), 1), 30);
  const out: CursorVendorSyncChunk[] = [];
  for (let endOffsetDays = 0; endOffsetDays < total; endOffsetDays += chunk) {
    out.push({
      endOffsetDays,
      lookbackDays: Math.min(chunk, total - endOffsetDays),
    });
  }
  return out;
}
