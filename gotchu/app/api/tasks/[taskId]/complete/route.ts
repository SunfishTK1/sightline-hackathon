/** @owner Will — POST complete task */
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ taskId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { taskId } = await ctx.params;
  return NextResponse.json({
    ok: false,
    error: `complete ${taskId} not implemented`,
  });
}
