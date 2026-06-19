import { describe, expect, it } from "vitest";
import { parseSyncForceParam } from "./page-load-request";

describe("parseSyncForceParam", () => {
  it("accepts 1, true, and yes", () => {
    expect(parseSyncForceParam("1")).toBe(true);
    expect(parseSyncForceParam("true")).toBe(true);
    expect(parseSyncForceParam("TRUE")).toBe(true);
    expect(parseSyncForceParam("yes")).toBe(true);
  });

  it("rejects empty and other values", () => {
    expect(parseSyncForceParam(null)).toBe(false);
    expect(parseSyncForceParam(undefined)).toBe(false);
    expect(parseSyncForceParam("")).toBe(false);
    expect(parseSyncForceParam("0")).toBe(false);
    expect(parseSyncForceParam("false")).toBe(false);
  });
});
