/** @owner Will — PATCH availability.isAvailable */
import { NextResponse } from "next/server";

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  void body;
  return NextResponse.json({
    ok: false,
    error: "PATCH /api/me/availability not implemented",
  });
}
