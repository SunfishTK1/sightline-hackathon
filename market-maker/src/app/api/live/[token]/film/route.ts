/**
 * The requester asks for a film of their task, and pays for it.
 *
 * voice-mcp charges before anything renders and derives the payer from the
 * order, so this cannot bill anyone but the person who asked for the task.
 * Generation itself is the agent's job - it holds the model credentials and is
 * the only thing that sends messages.
 */
import { withDb, HttpError } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { loadLiveBoard } from "@/lib/db/live";

const VOICE_MCP = (process.env.VOICE_MCP_URL || "").replace(/\/$/, "");
const VOICE_MCP_TOKEN = process.env.MCP_AUTH_TOKEN || process.env.VOICE_MCP_AUTH_TOKEN || "";

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
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

    const res = await fetch(
      `${VOICE_MCP}/v1/orders/${encodeURIComponent(board.orderId)}/film`,
      { method: "POST", headers, cache: "no-store", signal: AbortSignal.timeout(30_000) },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      reason?: string;
      data?: { railcoins?: number };
    };
    if (!res.ok || !json.ok) {
      throw new HttpError(
        res.status === 409 ? 409 : res.status === 402 ? 402 : 502,
        json.reason ?? json.error ?? "failed",
      );
    }

    return { ok: true, railcoins: json.data?.railcoins ?? null };
  });
}
