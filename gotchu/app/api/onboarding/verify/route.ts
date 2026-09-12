/**
 * Check the code that was texted to the number given at signup. Until this
 * passes the account exists but is not in the worker pool, so nothing automated
 * ever reaches an unproven number.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getIdentity } from "@/lib/identity";
import { verifyPhone, MarketError } from "@/lib/market";

const Body = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the six digit code") });

const MESSAGES: Record<string, string> = {
  wrong_code: "That code is not right. Check the text and try again.",
  expired: "That code has expired. Send yourself a new one.",
  too_many_attempts: "Too many tries. Send yourself a new code.",
  no_code: "There is no code waiting. Submit your details again.",
  no_account: "We have no signup for you yet. Start at the top of the form.",
};

export async function POST(req: Request) {
  const identity = await getIdentity();
  if (!identity) {
    return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_code" },
      { status: 400 },
    );
  }

  try {
    const result = await verifyPhone(identity.sub, parsed.data.code);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    const code = err instanceof MarketError ? err.code : "verify_failed";
    return NextResponse.json(
      { ok: false, error: code, message: MESSAGES[code] ?? "That did not work. Try again." },
      { status: 400 },
    );
  }
}
