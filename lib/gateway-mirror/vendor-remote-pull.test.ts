import { describe, expect, it } from "vitest";
import { pullRemoteGatewayUsageMirror } from "./vendor-remote-pull";

describe("pullRemoteGatewayUsageMirror", () => {
  it("returns a documented no-op (no network)", async () => {
    const r = await pullRemoteGatewayUsageMirror();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pulled).toBe(false);
    expect(r.detail).toMatch(/not implemented/i);
  });
});
