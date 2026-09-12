import { checkIMessageHealth, isLiveMessaging } from "@/lib/messaging/imessage";

export async function GET() {
  try {
    const status = await checkIMessageHealth();
    return Response.json({
      live: isLiveMessaging(),
      ...status,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 },
    );
  }
}
