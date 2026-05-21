import { afterEach, describe, expect, it } from "vitest";
import {
  allowUserCoachingInCurrentAppEnv,
  appEnvMode,
  guardrailRuleCodesForUserEmail,
  isUserModelCoachingEmailEnabled,
  userCoachingEmailActive,
} from "./user-coaching-config";

const env = process.env;

afterEach(() => {
  process.env = { ...env };
});

describe("userCoachingEmailActive", () => {
  it("is off when master switch unset", () => {
    delete process.env.USER_MODEL_COACHING_EMAIL;
    expect(isUserModelCoachingEmailEnabled()).toBe(false);
    expect(userCoachingEmailActive()).toBe(false);
  });

  it("is on in prod when switch set", () => {
    process.env.USER_MODEL_COACHING_EMAIL = "1";
    process.env.APP_ENV = "prod";
    expect(userCoachingEmailActive()).toBe(true);
  });

  it("is off in dev unless ALLOW_DEV", () => {
    process.env.USER_MODEL_COACHING_EMAIL = "1";
    process.env.APP_ENV = "dev";
    delete process.env.USER_MODEL_COACHING_ALLOW_DEV;
    expect(allowUserCoachingInCurrentAppEnv()).toBe(false);
    expect(userCoachingEmailActive()).toBe(false);
    process.env.USER_MODEL_COACHING_ALLOW_DEV = "true";
    expect(userCoachingEmailActive()).toBe(true);
  });
});

describe("guardrailRuleCodesForUserEmail", () => {
  it("defaults to complexity coaching rules", () => {
    delete process.env.GUARDRAIL_USER_COACHING_RULE_CODES;
    const codes = guardrailRuleCodesForUserEmail();
    expect(codes.has("NON_COMPLEX_HEAVY_MODEL_SELECTED")).toBe(true);
    expect(codes.has("UNAPPROVED_MODEL_ENDPOINT")).toBe(false);
  });

  it("honours override env", () => {
    process.env.GUARDRAIL_USER_COACHING_RULE_CODES = "FOO,BAR";
    expect([...guardrailRuleCodesForUserEmail()]).toEqual(["FOO", "BAR"]);
  });
});

describe("appEnvMode", () => {
  it("detects staging", () => {
    process.env.APP_ENV = "staging";
    expect(appEnvMode()).toBe("staging");
  });
});
