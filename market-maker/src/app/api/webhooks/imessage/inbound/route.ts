import { createHmac, timingSafeEqual } from "crypto";
import { handleInboundMessage } from "@/lib/messaging/twilio";

function verifySignature(raw: Buffer, request: Request, secret: string) {
  const timestamp = request.headers.get("x-velroi-timestamp") ?? "";
  const supplied = request.headers.get("x-velroi-signature") ?? "";
  if (
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !/^v1=[0-9a-f]{64}$/.test(supplied)
  ) {
    throw new Error("Invalid webhook");
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(raw)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(supplied.slice(3), "hex"))) {
    throw new Error("Invalid webhook");
  }
}

export async function POST(request: Request) {
  const raw = Buffer.from(await request.arrayBuffer());
  const secret = process.env.IMESSAGE_WEBHOOK_SECRET;
  if (secret) {
    try {
      verifySignature(raw, request, secret);
    } catch {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const event = JSON.parse(raw.toString("utf8")) as {
    id?: string;
    type?: string;
    createdAt?: string;
    data?: {
      providerMessageId?: string;
      sender?: string;
      body?: string | null;
      receivedAt?: string;
    };
  };

  if (event.type === "message.received" && event.data?.sender) {
    await handleInboundMessage({
      providerMessageId: event.data.providerMessageId ?? event.id ?? "",
      from: event.data.sender,
      body: event.data.body ?? "",
      receivedAt: event.data.receivedAt
        ? new Date(event.data.receivedAt)
        : new Date(),
    });
  }

  return Response.json({ ok: true });
}
