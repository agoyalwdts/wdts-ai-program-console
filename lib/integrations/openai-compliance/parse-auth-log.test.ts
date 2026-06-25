import { describe, expect, it } from "vitest";
import { extractAuthEventsFromLogBody } from "./parse-auth-log";

describe("extractAuthEventsFromLogBody", () => {
  it("collects IPs, clients, user agents, and devices", () => {
    const body = [
      JSON.stringify({
        email: "u@wdtablesystems.com",
        ip_address: "10.0.0.1",
        client_name: "ChatGPT Web",
        user_agent: "Mozilla/5.0",
        device_type: "desktop",
      }),
      JSON.stringify({
        user_email: "other@wdtablesystems.com",
        ip: "10.0.0.2",
      }),
    ].join("\n");

    const hit = extractAuthEventsFromLogBody(body, "u@wdtablesystems.com");
    expect(hit.eventCount).toBe(1);
    expect(hit.ips).toEqual(["10.0.0.1"]);
    expect(hit.clients).toEqual(["ChatGPT Web"]);
    expect(hit.userAgents).toEqual(["Mozilla/5.0"]);
    expect(hit.devices).toEqual(["desktop"]);
  });
});
