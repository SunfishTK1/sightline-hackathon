import { withDb, HttpError } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { addLiveMessage } from "@/lib/db/live";

export async function POST(request: Request) {
  return withDb(async () => {
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
