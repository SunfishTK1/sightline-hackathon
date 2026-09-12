/** @owner Thomas — GET one task, PATCH structured fields */
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ taskId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { taskId } = await ctx.params;
  return NextResponse.json({
    ok: false,
    error: `GET task ${taskId} not implemented`,
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { taskId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  void body;
  return NextResponse.json({
    ok: false,
    error: `PATCH task ${taskId} not implemented`,
  });
}
