/** @owner Will — POST ethics review */
import { NextResponse } from "next/server";
import { reviewTask } from "@/lib/agents/ethics";
import type { StructuredTask } from "@/lib/types/task";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body.structured) {
    const verdict = await reviewTask(body.structured as StructuredTask);
    return NextResponse.json({ ok: true, data: verdict });
  }
  return NextResponse.json({
    ok: false,
    error: "pass { structured } or { taskId }",
  });
}
