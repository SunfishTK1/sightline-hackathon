/**
 * @owner Will
 * Legacy /api/auth/* stub. v4 mounts login, callback, and logout
 * on /auth/* through middleware — do not add handlers here.
 */
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ auth0: string }> };

export async function GET(_req: Request, _ctx: Ctx) {
  return NextResponse.json(
    { ok: false, error: "Use /auth/login, /auth/logout, or /auth/callback" },
    { status: 404 },
  );
}
