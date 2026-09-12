/** @owner Will — POST create user + embed preference */
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  // TODO(Will): validate body, embed preferenceText, upsert user
  const body = await req.json().catch(() => ({}));
  void body;
  return NextResponse.json({
    ok: false,
    error: "onboarding not implemented",
  });
}
