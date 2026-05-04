import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time compare for `Authorization: Bearer <secret>` used by
 * LiteLLM generic_api callback headers.
 */
export function verifyLiteLLmBearerToken(args: {
  authorizationHeader: string | null;
  secret: string;
}): { ok: true } | { ok: false; reason: string } {
  if (!args.authorizationHeader) {
    return { ok: false, reason: "missing Authorization header" };
  }
  const prefix = "Bearer ";
  if (!args.authorizationHeader.startsWith(prefix)) {
    return { ok: false, reason: "Authorization must be Bearer token" };
  }
  const presented = args.authorizationHeader.slice(prefix.length);
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(args.secret, "utf8");
  if (a.length !== b.length) {
    return { ok: false, reason: "token length mismatch" };
  }
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: "token mismatch" };
  }
  return { ok: true };
}
