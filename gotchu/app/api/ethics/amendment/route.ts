/** @owner Daphne — POST ethics amendment review */
import { NextResponse } from "next/server";
import { reviewAmendment } from "@/lib/agents/ethics";
import type { StructuredTask } from "@/lib/types/task";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!body.original || !body.proposed) {
    return NextResponse.json({
      ok: false,
      error: "pass { original, proposed }",
    });
  }
  const data = await reviewAmendment(
    body.original as StructuredTask,
    body.proposed as StructuredTask,
  );
  return NextResponse.json({ ok: true, data });
}
