/** @owner Thomas — POST create task, GET mine */
import { NextResponse } from "next/server";

export async function GET() {
  // TODO(Thomas): list requester's tasks
  return NextResponse.json({ ok: true, data: { tasks: [] } });
}

export async function POST(req: Request) {
  // TODO(Thomas): parseTask → embed → reviewTask → insert
  const body = await req.json().catch(() => ({}));
  void body;
  return NextResponse.json({ ok: false, error: "POST /api/tasks not implemented" });
}
