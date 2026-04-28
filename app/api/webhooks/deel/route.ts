/**
 * Deel HRIS webhook receiver.
 *
 * Flow per request:
 *   1. Read raw body (REQUIRED: the HMAC signature is over the bytes,
 *      not the parsed JSON; we cannot use req.json() before verifying).
 *   2. Verify HMAC-SHA256 signature against DEEL_WEBHOOK_SECRET. If
 *      missing or wrong → 401, no further work.
 *   3. Parse the envelope into a DeelWebhookEvent. If the shape is
 *      anything we don't recognise (e.g. a synthetic test event), return
 *      202 (accepted, won't retry) without doing anything.
 *   4. Record an append-only Decision row with type METHODOLOGY_CHANGE
 *      so there's an audit trail of what triggered any downstream sync.
 *      No Prisma mutation of User / License here — webhooks are advisory
 *      hints; the source of truth is Deel's REST API. A nightly /
 *      reconciler-driven pass closes the loop.
 *   5. 200 OK.
 *
 * The route deliberately does NOT call requireUser() — webhooks come
 * from Deel's outbound IPs and authenticate via HMAC, not session
 * cookies. The proxy.ts matcher excludes /api/webhooks/* (added in this
 * PR alongside the route).
 *
 * Refs: scoping §4 integration #3.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseDeelWebhook, verifyDeelSignature } from "@/lib/integrations/deel/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.DEEL_WEBHOOK_SECRET;
  if (!secret) {
    // Don't fail open. If the secret isn't set, refuse the webhook
    // entirely so a misconfigured deploy can't quietly accept arbitrary
    // bodies.
    return NextResponse.json(
      { error: "DEEL_WEBHOOK_SECRET is not configured." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const verification = verifyDeelSignature({
    rawBody,
    signatureHeader: request.headers.get("x-deel-signature"),
    secret,
  });
  if (!verification.ok) {
    return NextResponse.json(
      { error: `signature verification failed: ${verification.reason}` },
      { status: 401 },
    );
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const event = parseDeelWebhook(
    envelope as Parameters<typeof parseDeelWebhook>[0],
  );
  if (!event) {
    return NextResponse.json(
      { ok: true, action: "ignored", reason: "unrecognised envelope" },
      { status: 202 },
    );
  }

  // Audit trail. Deliberate non-mutation of User / License — the
  // dashboard re-fetches authoritative state via DeelClient on the
  // next tick of the reconciler (Track 3, lands separately).
  await prisma.decision.create({
    data: {
      type: "METHODOLOGY_CHANGE",
      // No Prisma user yet may exist for a brand-new hire — link by
      // email when we can, leave subjectUserId null otherwise.
      subjectUserId: (await prisma.user.findUnique({
        where: { email: event.email },
        select: { id: true },
      }))?.id,
      beforeState: JSON.stringify({}),
      afterState: JSON.stringify({
        deelEvent: event.type,
        email: event.email,
        roleTag: event.payload.roleTag,
        managerEmail: event.payload.managerEmail,
        status: event.payload.status,
      }),
      actorEmail: "deel-webhook@dashboard",
      justification: `Deel webhook: ${event.type} for ${event.email}`,
    },
  });

  return NextResponse.json({
    ok: true,
    action: "recorded",
    eventType: event.type,
    email: event.email,
  });
}
