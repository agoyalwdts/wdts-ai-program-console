import { describe, expect, it } from "vitest";
import { addBusinessDays } from "@/lib/datetime/business-days";

describe("addBusinessDays", () => {
  it("skips weekends", () => {
    // Friday 2026-05-29 + 1 business day → Monday 2026-06-01
    const fri = new Date("2026-05-29T12:00:00.000Z");
    const end = addBusinessDays(fri, 1);
    expect(end.getUTCDay()).toBe(1);
    expect(end.toISOString().slice(0, 10)).toBe("2026-06-01");
  });

  it("adds five business days across a weekend", () => {
    const mon = new Date("2026-05-25T09:00:00.000Z"); // Monday
    const end = addBusinessDays(mon, 5);
    expect(end.toISOString().slice(0, 10)).toBe("2026-06-01");
  });
});
