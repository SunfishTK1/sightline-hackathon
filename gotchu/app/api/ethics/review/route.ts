/** @owner Daphne — POST ethics review */
import { NextResponse } from "next/server";
import { parseEthicsStructured, reviewTask } from "@/lib/agents/ethics";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const structured = parseEthicsStructured(body.structured);
  if (!structured) {
    return NextResponse.json(
      {
        ok: false,
        error: "pass a complete { structured } task",
      },
      { status: 400 },
    );
  }
  const verdict = await reviewTask(structured);
  return NextResponse.json({ ok: true, data: verdict });
}
