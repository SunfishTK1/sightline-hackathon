/** @owner Divya — POST match → candidates */
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ taskId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { taskId } = await ctx.params;
  // TODO(Divya): set MATCHING, findCandidates, return top 5
  return NextResponse.json({
    ok: false,
    error: `match for ${taskId} not implemented`,
  });
}
