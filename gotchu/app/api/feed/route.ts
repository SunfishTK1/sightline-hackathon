/** @owner Daphne — GET open task pool */
import { NextResponse } from "next/server";

export async function GET() {
  // TODO(Daphne): query tasks with status OPEN; poll every 3s from UI
  return NextResponse.json({ ok: true, data: { tasks: [] } });
}
