/** @owner Daphne — POST ethics arbitrate (once per negotiate turn) */
import { NextResponse } from "next/server";
import { arbitrateMove } from "@/lib/agents/ethics";
import type { ArbitrateInput } from "@/lib/types/ethics";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!body.originalStructured || !body.currentStructured || !body.proposed) {
    return NextResponse.json({
      ok: false,
      error: "pass ArbitrateInput { originalStructured, currentStructured, role, proposed, transcript }",
    });
  }
  const data = await arbitrateMove(body as ArbitrateInput);
  return NextResponse.json({ ok: true, data });
}
