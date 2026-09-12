/** @owner Daphne — POST approve offer (requester | worker) */
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ offerId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { offerId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  void offerId;
  void body;
  return NextResponse.json({
    ok: false,
    error: "approve not implemented",
  });
}
