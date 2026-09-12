/** @owner Daphne — POST ethics arbitrate (once per negotiate turn) */
import { NextResponse } from "next/server";
import { arbitrateMove } from "@/lib/agents/ethics";
import type { ArbitrateInput } from "@/lib/types/ethics";
import { arbitrateInputSchema } from "@/lib/validate";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = arbitrateInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error:
          parsed.error.issues[0]?.message ??
          "pass ArbitrateInput { originalStructured, currentStructured, role, proposed, transcript }",
      },
      { status: 400 },
    );
  }
  const data = await arbitrateMove(parsed.data as ArbitrateInput);
  return NextResponse.json({ ok: true, data });
}
