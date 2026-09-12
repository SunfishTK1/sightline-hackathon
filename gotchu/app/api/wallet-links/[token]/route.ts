/**
 * Create the wallet for whoever holds this link. Proxied rather than called
 * from the browser so the marketplace service stays on the private network.
 */
import { NextResponse } from "next/server";

const MARKET = (process.env.MARKET_API_URL || "").replace(/\/$/, "");

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!MARKET) {
    return NextResponse.json({ ok: false, error: "market_not_configured" }, { status: 503 });
  }
  try {
    const res = await fetch(
      `${MARKET}/v1/wallet-links/${encodeURIComponent(token)}/wallet`,
      { method: "POST", cache: "no-store" },
    );
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch {
    return NextResponse.json({ ok: false, error: "unreachable" }, { status: 502 });
  }
}
