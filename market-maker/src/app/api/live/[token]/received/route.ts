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

    const res = await fetch(
      `${VOICE_MCP}/v1/orders/${encodeURIComponent(board.orderId)}/received`,
      { method: "POST", cache: "no-store", signal: AbortSignal.timeout(30_000) },
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
