import { describe, expect, it } from "vitest";
import { extractAuthEventsFromLogBody } from "./parse-auth-log";

describe("extractAuthEventsFromLogBody", () => {
  it("finds email and ip in JSONL lines", () => {
    const body = [
      JSON.stringify({ email: "other@x.com", ip_address: "1.1.1.1" }),
      JSON.stringify({ user_email: "dev@wdtablesystems.com", client_ip: "203.0.113.5" }),
      JSON.stringify({
        actor: { email: "dev@wdtablesystems.com" },
        session: { ip: "203.0.113.5" },
      }),
    ].join("\n");

    const hit = extractAuthEventsFromLogBody(body, "dev@wdtablesystems.com");
    expect(hit.eventCount).toBe(2);
    expect(hit.ips).toEqual(["203.0.113.5"]);
  });
});
