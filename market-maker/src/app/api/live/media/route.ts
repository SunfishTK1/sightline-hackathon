import { withDb, HttpError } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { attachLiveMedia } from "@/lib/db/live";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withDb(async () => {
    await ensureSchema();
    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string;
      token?: string;
      kind?: "image" | "video";
      pngBase64?: string;
      mp4Base64?: string;
      storageKey?: string;
      prompt?: string;
    };
    if ((!body.orderId && !body.token) || !body.kind) {
      throw new HttpError(400, "orderId or token, and kind, are required");
    }
    const raw = body.kind === "image" ? body.pngBase64 : body.mp4Base64;
    if (!raw && !body.storageKey) {
      throw new HttpError(400, "storageKey or pngBase64/mp4Base64 is required");
    }
    const view = await attachLiveMedia({
      orderId: body.orderId,
      token: body.token,
      kind: body.kind,
      bytes: raw ? Buffer.from(raw, "base64") : undefined,
      storageKey: body.storageKey,
      contentType: body.kind === "image" ? "image/png" : "video/mp4",
      prompt: body.prompt,
    });
    if (!view) throw new HttpError(404, "No live board for that order");
    return view;
  });
}
