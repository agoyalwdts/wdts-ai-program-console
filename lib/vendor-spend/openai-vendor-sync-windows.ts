/** Incremental cron + single manual window (avoids OpenAI org/costs timeouts). */
export const OPENAI_VENDOR_SYNC_CHUNK_DAYS = 31;

/** Max single admin/cron request lookback (non-chunked). */
export const OPENAI_VENDOR_MANUAL_MAX_LOOKBACK_DAYS = 31;

/** Max total history for chunked backfill. */
export const OPENAI_VENDOR_MAX_BACKFILL_DAYS = 120;

/** Default Settings backfill depth. */
export const OPENAI_VENDOR_DEFAULT_BACKFILL_DAYS = 120;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type OpenAiVendorSyncChunk = {
  endOffsetDays: number;
  lookbackDays: number;
};

/** Window ending `endOffsetDays` ago: [now - endOffset - lookback, now - endOffset]. */
export function openAiVendorSyncWindowMs(args: {
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
export function openAiVendorBackfillChunks(
  totalLookbackDays: number,
  chunkDays: number = OPENAI_VENDOR_SYNC_CHUNK_DAYS,
): OpenAiVendorSyncChunk[] {
  const total = Math.min(
    Math.max(Math.floor(totalLookbackDays), 1),
    OPENAI_VENDOR_MAX_BACKFILL_DAYS,
  );
  const chunk = Math.min(Math.max(Math.floor(chunkDays), 1), OPENAI_VENDOR_SYNC_CHUNK_DAYS);
  const out: OpenAiVendorSyncChunk[] = [];
  for (let endOffsetDays = 0; endOffsetDays < total; endOffsetDays += chunk) {
    out.push({
      endOffsetDays,
      lookbackDays: Math.min(chunk, total - endOffsetDays),
    });
  }
  return out;
}
