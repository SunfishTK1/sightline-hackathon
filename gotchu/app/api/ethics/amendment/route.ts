/** @owner Daphne — POST ethics amendment review */
import { NextResponse } from "next/server";
import { parseEthicsStructured, reviewAmendment } from "@/lib/agents/ethics";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // voice-mcp posts originalStructured / proposedStructured. The route
  // originally read original / proposed. Accept both so a live edit cannot
  // skip the same-job check.
  const original = parseEthicsStructured(
    body.originalStructured ?? body.original,
  );
  const proposed = parseEthicsStructured(
    body.proposedStructured ?? body.proposed,
  );
  if (!original || !proposed) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "pass complete { original, proposed } or { originalStructured, proposedStructured } tasks",
      },
      { status: 400 },
    );
  }
  const data = await reviewAmendment(original, proposed);
  return NextResponse.json({ ok: true, data });
}
