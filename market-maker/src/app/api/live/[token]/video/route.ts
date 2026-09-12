import { ensureSchema } from "@/lib/db/schema";
import { getLiveMediaBytes } from "@/lib/db/live";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  await ensureSchema();
  const { token } = await context.params;
  const media = await getLiveMediaBytes(token, "video");
  if (!media) {
    return Response.json({ error: "No video yet" }, { status: 404 });
  }
  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "Content-Type": media.contentType,
      "Cache-Control": "no-store",
    },
  });
}
