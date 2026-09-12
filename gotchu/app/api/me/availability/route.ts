/** @owner Will — PATCH availability.isAvailable */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getIdentity } from "@/lib/identity";
import { setAvailable, MarketError } from "@/lib/market";

const Body = z.object({ isAvailable: z.boolean() });

export async function PATCH(req: Request) {
  const identity = await getIdentity();
  if (!identity) {
    return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "isAvailable is required" }, { status: 400 });
  }
  try {
    // An unverified number cannot be made available, whatever the toggle says.
    const result = await setAvailable(identity.sub, parsed.data.isAvailable);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    const code = err instanceof MarketError ? err.code : "failed";
    return NextResponse.json({ ok: false, error: code }, { status: 400 });
  }
}
