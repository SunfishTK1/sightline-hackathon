/**
 * The requester says the task arrived, and pays, from the board.
 *
 * The board token is the authorisation, the same trust the link itself rests
 * on. voice-mcp derives both the requester and the worker from the order, so
 * nothing here can redirect a payment - the worst a forwarded link can do is
 * confirm a task early, not send money somewhere else.
 */
import { withDb, HttpError } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { loadLiveBoard } from "@/lib/db/live";

const VOICE_MCP = (process.env.VOICE_MCP_URL || "").replace(/\/$/, "");
const VOICE_MCP_TOKEN = process.env.MCP_AUTH_TOKEN || process.env.VOICE_MCP_AUTH_TOKEN || "";

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  // withDb serialises whatever this returns, so hand back plain data and throw
  // for failures - returning a Response here turns into an empty body, which
  // reads to the caller as a payment that did not happen.
  return withDb(async () => {
    await ensureSchema();
    const board = await loadLiveBoard(token);
    if (!board) throw new HttpError(404, "no_board");
    if (!VOICE_MCP) throw new HttpError(503, "not_configured");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (VOICE_MCP_TOKEN) {
      headers.Authorization = `Bearer ${VOICE_MCP_TOKEN}`;
      headers["x-api-key"] = VOICE_MCP_TOKEN;
    }

    const orderRes = await fetch(`${VOICE_MCP}/v1/orders/${encodeURIComponent(board.orderId)}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const orderJson = (await orderRes.json().catch(() => ({}))) as {
      ok?: boolean;
      data?: { requester_phone?: string };
    };
    const phone = orderJson.data?.requester_phone;
    if (!orderRes.ok || !phone) throw new HttpError(502, "no_requester");

    const res = await fetch(
      `${VOICE_MCP}/v1/orders/${encodeURIComponent(board.orderId)}/received`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ phone }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      data?: { settlement?: { settled?: boolean; railcoins?: number } };
    };
    if (!res.ok || !json.ok) {
      throw new HttpError(res.status === 409 ? 409 : 502, json.error ?? "failed");
    }

    return {
      ok: true,
      paid: json.data?.settlement?.settled ?? false,
      railcoins: json.data?.settlement?.railcoins ?? null,
    };
  });
}
