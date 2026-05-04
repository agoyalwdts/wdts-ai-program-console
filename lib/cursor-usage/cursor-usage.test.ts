import { describe, expect, it } from "vitest";
import { parseCursorUsageCsv } from "./parse-csv";
import { evaluatePrudence } from "./rules";
import { prudenceDedupeKey } from "./dedupe";

const SAMPLE_HEADER = `Date,User,Team,Kind,Model,Max Mode,Input (w/ cache write),Input (no cache),Cache Read,Output Tokens,Total Tokens,Cost`;

describe("parseCursorUsageCsv", () => {
  it("parses a Cursor-shaped row", () => {
    const csv = `${SAMPLE_HEADER}
2026-04-30T12:00:00.000Z,pmishra@wdtablesystems.com,,Included,claude-4.6-opus-max-thinking-fast,Yes,160882,7025,2117021,13340,2298268,14.79`;
    const r = parseCursorUsageCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    expect(row.userEmail).toBe("pmishra@wdtablesystems.com");
    expect(row.model).toContain("opus-max-thinking");
    expect(row.maxMode).toBe(true);
    expect(row.cacheRead).toBe(2_117_021);
    expect(row.outputTokens).toBe(13_340);
    expect(row.costUsd).toBeCloseTo(14.79, 2);
  });
});

describe("evaluatePrudence", () => {
  it("flags opus max thinking + max mode + high cache + low output (user example)", () => {
    const csv = `${SAMPLE_HEADER}
2026-04-30T12:00:00.000Z,pmishra@wdtablesystems.com,,Included,claude-4.6-opus-max-thinking-fast,Yes,160882,7025,2117021,13340,2298268,14.79`;
    const r = parseCursorUsageCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = evaluatePrudence(r.rows[0]!);
    expect(ev).not.toBeNull();
    expect(ev!.ruleCode).toBe("OPUS_MAX_THINKING_LOW_OUTPUT_VS_CACHE");
  });

  it("flags thinking-xhigh with high cost and moderate output", () => {
    const csv = `${SAMPLE_HEADER}
2026-05-01T10:00:00.000Z,a@example.com,,Included,claude-opus-4-7-thinking-xhigh,No,1000,500,10000,12000,24500,7.5`;
    const r = parseCursorUsageCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = evaluatePrudence(r.rows[0]!);
    expect(ev).not.toBeNull();
    expect(ev!.ruleCode).toBe("THINKING_XHIGH_HIGH_COST_LOW_OUTPUT");
  });

  it("returns null for a cheap sonnet row", () => {
    const csv = `${SAMPLE_HEADER}
2026-05-01T10:00:00.000Z,a@example.com,,Included,claude-3-5-sonnet,No,100,200,0,500,800,0.02`;
    const r = parseCursorUsageCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(evaluatePrudence(r.rows[0]!)).toBeNull();
  });
});

describe("prudenceDedupeKey", () => {
  it("is stable for the same row + rule", () => {
    const csv = `${SAMPLE_HEADER}
2026-04-30T12:00:00.000Z,u@x.com,,Included,claude-opus,Yes,1,2,3,4,5,1`;
    const r = parseCursorUsageCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = r.rows[0]!;
    const a = prudenceDedupeKey(row, "RULE_A");
    const b = prudenceDedupeKey(row, "RULE_A");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});
