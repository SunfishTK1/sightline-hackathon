/** @owner Daphne — POST ethics amendment review */
import { NextResponse } from "next/server";
import { reviewAmendment } from "@/lib/agents/ethics";
import { structuredTaskSchema } from "@/lib/validate";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const original = structuredTaskSchema.safeParse(body?.original);
  const proposed = structuredTaskSchema.safeParse(body?.proposed);
  if (!original.success || !proposed.success) {
    return NextResponse.json(
      {
        ok: false,
        error:
          original.error?.issues[0]?.message ??
          proposed.error?.issues[0]?.message ??
          "pass complete { original, proposed } structured tasks",
      },
      { status: 400 },
    );
  }
  const data = await reviewAmendment(original.data, proposed.data);
  return NextResponse.json({ ok: true, data });
}
