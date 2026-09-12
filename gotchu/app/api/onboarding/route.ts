/**
 * Sign someone up. The Auth0 subject and email come from the session, never
 * from the body - otherwise a request could claim to be anyone.
 *
 * This writes into the live marketplace, so a person who signs up here is the
 * same person the phone agent talks to, with one account keyed on their phone.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getIdentity } from "@/lib/identity";
import { createSignup, MarketError, marketConfigured } from "@/lib/market";

const Body = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().max(60).optional().default(""),
  // Accept what people actually type; the marketplace normalises and rejects
  // anything that is not a real number.
  phone: z
    .string()
    .trim()
    .min(10, "That phone number is too short")
    .max(20)
    .regex(/^[+\d][\d\s().-]+$/, "That does not look like a phone number"),
  preferenceText: z.string().trim().max(1000).optional().default(""),
  categories: z.array(z.string().trim().min(1)).max(12).optional().default([]),
  minPriceUsd: z.number().min(0).max(1000).optional(),
  wantsWork: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const identity = await getIdentity();
  if (!identity) {
    return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  }
  if (!identity.isCmu) {
    return NextResponse.json({ ok: false, error: "cmu_email_required" }, { status: 403 });
  }
  if (!marketConfigured()) {
    return NextResponse.json({ ok: false, error: "market_not_configured" }, { status: 503 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_body" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  try {
    const result = await createSignup({
      auth0_sub: identity.sub,
      email: identity.email,
      display_name: [body.firstName, body.lastName].filter(Boolean).join(" "),
      phone: body.phone,
      blurb: body.preferenceText || undefined,
      categories: body.categories,
      min_price_usd: body.minPriceUsd,
      wants_work: body.wantsWork,
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof MarketError) {
      // A number already tied to another account is the one case worth naming:
      // it would otherwise silently hand one person's thread to another.
      const status = err.code === "phone_in_use" ? 409 : 502;
      return NextResponse.json({ ok: false, error: err.code, message: err.message }, { status });
    }
    return NextResponse.json({ ok: false, error: "signup_failed" }, { status: 500 });
  }
}
