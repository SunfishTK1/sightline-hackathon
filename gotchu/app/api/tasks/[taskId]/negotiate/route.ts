/** @owner Daphne — POST negotiate with a worker */
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ taskId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { taskId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  void body;
  return NextResponse.json({
    ok: false,
    error: `negotiate for ${taskId} not implemented`,
  });
}
