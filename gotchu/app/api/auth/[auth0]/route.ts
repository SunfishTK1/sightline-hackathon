/**
 * @owner Will
 * Auth0 catch-all. Wire with @auth0/nextjs-auth0 handlers.
 */
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ auth0: string }> };

export async function GET(_req: Request, _ctx: Ctx) {
  // TODO(Will): Auth0 login / logout / callback
  return NextResponse.json({
    ok: false,
    error: "Auth0 routes not wired yet",
  });
}
