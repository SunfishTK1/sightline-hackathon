/** @owner Daphne — POST ethics review */
import { NextResponse } from "next/server";
import { reviewTask } from "@/lib/agents/ethics";
import { structuredTaskSchema } from "@/lib/validate";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = structuredTaskSchema.safeParse(body?.structured);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "pass a complete { structured } task",
      },
      { status: 400 },
    );
  }
  const verdict = await reviewTask(parsed.data);
  return NextResponse.json({ ok: true, data: verdict });
}
