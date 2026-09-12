import { withDb, HttpError } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { addLiveMessage, loadLiveBoard, loadLiveBoardForOrder } from "@/lib/db/live";

const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || process.env.VOICE_MCP_AUTH_TOKEN || "";

function authorized(request: Request): boolean {
  if (!AUTH_TOKEN) return true; // open only in local/demo environments
  return (
    request.headers.get("authorization") === `Bearer ${AUTH_TOKEN}` ||
    request.headers.get("x-api-key") === AUTH_TOKEN
  );
}

export async function POST(request: Request) {
  return withDb(async () => {
    if (!authorized(request)) throw new HttpError(401, "Unauthorized");
    await ensureSchema();
    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string;
      token?: string;
      author?: "requester" | "worker" | "gotchu";
      body?: string;
    };
    if ((!body.orderId && !body.token) || !body.body?.trim()) {
      throw new HttpError(400, "orderId or token, and body, are required");
    }
    const board = body.token
      ? await loadLiveBoard(body.token)
      : await loadLiveBoardForOrder(body.orderId!);
    if (!board) throw new HttpError(404, "No live board for that order");
    if (board.status !== "agreed") {
      throw new HttpError(409, "Chat opens after someone takes the job.");
    }
    const author = body.author === "requester" || body.author === "gotchu" ? body.author : "worker";
    const view = await addLiveMessage({
      token: body.token,
      orderId: body.orderId,
      author,
      body: body.body,
    });
    if (!view) throw new HttpError(404, "No live board for that order");
    return view;
  });
}
