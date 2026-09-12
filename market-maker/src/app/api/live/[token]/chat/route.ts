import { withDb, HttpError } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { addLiveMessage, loadLiveBoard } from "@/lib/db/live";

const VOICE_MCP = (process.env.VOICE_MCP_URL || "").replace(/\/$/, "");
const VOICE_MCP_TOKEN = process.env.MCP_AUTH_TOKEN || process.env.VOICE_MCP_AUTH_TOKEN || "";

function voiceHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (VOICE_MCP_TOKEN) {
    headers.Authorization = `Bearer ${VOICE_MCP_TOKEN}`;
    headers["x-api-key"] = VOICE_MCP_TOKEN;
  }
  return headers;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  return withDb(async () => {
    await ensureSchema();
    const { token } = await context.params;
    const board = await loadLiveBoard(token);
    if (!board) throw new HttpError(404, "Live board not found");
    if (board.status !== "agreed") {
      throw new HttpError(409, "Chat opens after someone takes the job.");
    }
    const body = (await request.json().catch(() => ({}))) as { body?: string };
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) throw new HttpError(400, "Say something first.");

    const next = await addLiveMessage({ token, author: "requester", body: text });
    if (VOICE_MCP) {
      await fetch(`${VOICE_MCP}/v1/orders/${encodeURIComponent(board.orderId)}/relay-chat`, {
        method: "POST",
        headers: voiceHeaders(),
        body: JSON.stringify({ body: text, to: "worker" }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
    }
    return next ?? board;
  });
}
