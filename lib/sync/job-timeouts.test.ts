import { describe, expect, it } from "vitest";
import {
  PAGE_LOAD_SYNC_MAX_WAIT_MS,
  resolveSyncJobTimeoutMs,
} from "./job-timeouts";

describe("resolveSyncJobTimeoutMs", () => {
  it("gives codex a longer page_load budget than default", () => {
    expect(resolveSyncJobTimeoutMs("codex_enterprise_spend", "page_load")).toBe(40_000);
    expect(resolveSyncJobTimeoutMs("workspace_analytics", "page_load")).toBe(20_000);
  });

  it("honours explicit override", () => {
    expect(resolveSyncJobTimeoutMs("codex_enterprise_spend", "page_load", 5_000)).toBe(5_000);
  });

  it("uses page load max wait constant for shell budget", () => {
    expect(PAGE_LOAD_SYNC_MAX_WAIT_MS).toBeGreaterThanOrEqual(40_000);
  });
});
