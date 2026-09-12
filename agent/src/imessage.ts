import { config } from "./config.js";

export type RelayEvent = {
  sequence: number;
  id: string;
  type: string;
  data: {
    sender?: string;
    body?: string;
    isGroup?: boolean;
    optOut?: boolean;
    /** Set when they used Messages' inline reply on a specific earlier message. */
    inReplyTo?: {
      nativeMessageId?: string;
      part?: string;
      /** Our own requestId, when the message they replied to was one we sent. */
      providerMessageId?: string | null;
    } | null;

    /** message.reaction only: a tapback on one of our messages. */
    action?: "added" | "removed";
    kind?: "loved" | "liked" | "disliked" | "laughed" | "emphasized" | "questioned" | "emoji";
    emoji?: string | null;
    target?: {
      nativeMessageId?: string;
      part?: string;
      providerMessageId?: string | null;
    } | null;
    recipient?: string;
    attachments?: Array<{
      id: string;
      name?: string;
      mimeType?: string;
      size?: number;
      downloadPath?: string;
    }>;
  };
};

const headers = () => ({
  Authorization: `Bearer ${config.imessageKey}`,
  "Content-Type": "application/json",
});

export async function pollEvents(
  after: number,
): Promise<{ events: RelayEvent[]; nextCursor: number }> {
  const res = await fetch(
    `${config.imessageUrl}/v1/events?after=${after}&limit=50`,
    { headers: headers() },
  );
  if (!res.ok) throw new Error(`poll failed: HTTP ${res.status}`);
  const body = (await res.json()) as { events: RelayEvent[]; nextCursor: number };
  return { events: body.events ?? [], nextCursor: body.nextCursor ?? after };
}

/**
 * Send one text. `idempotencyKey` must be derived from whatever caused the
 * send, so a retry can never produce a second message.
 */
export type SendResult = {
  /** The relay accepted the send. This is NOT proof of delivery. */
  accepted: boolean;
  requestId?: string;
  /** Opted out, or otherwise pointless to retry. */
  permanent?: boolean;
  detail: string;
};

/** Upload a file and get an attachment id back. Valid for about 24 hours. */
export async function uploadAttachment(
  bytes: Buffer | string,
  contentType: string,
): Promise<string | null> {
  const buf = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  const res = await fetch(`${config.imessageUrl}/v1/attachments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.imessageKey}`,
      "Content-Type": contentType,
    },
    // fetch wants a BodyInit; a Buffer is a Uint8Array but not typed as one.
    body: new Uint8Array(buf),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { attachmentId?: string };
  return body.attachmentId ?? null;
}

export async function sendText(
  to: string,
  text: string,
  idempotencyKey: string,
  attachmentIds?: string[],
): Promise<SendResult> {
  const payload: Record<string, unknown> = {
    to,
    text,
    service: "iMessage",
    consent: true,
  };
  // Bare ids; a list of objects is rejected.
  if (attachmentIds?.length) payload.attachments = attachmentIds;

  // The relay runs one automation at a time and answers 429 when it is busy.
  // That is a wait, not a failure: retry the same request with the same key,
  // or the message is simply lost.
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${config.imessageUrl}/v1/messages`, {
      method: "POST",
      headers: { ...headers(), "Idempotency-Key": idempotencyKey.slice(0, 120) },
      body: JSON.stringify(payload),
    });
    if (res.status !== 429 || attempt >= 3) break;
    const after = Number(res.headers.get("retry-after")) || 2;
    await new Promise((r) => setTimeout(r, Math.min(after, 15) * 1000));
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 202) {
    return { accepted: true, requestId: String(body.requestId ?? ""), detail: "submitted" };
  }
  if (res.status === 403 && body.error === "recipient_opted_out") {
    return { accepted: false, permanent: true, detail: "opted_out" };
  }
  return {
    accepted: false,
    detail: `HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`,
  };
}

/** Pull an inbound attachment's bytes. The relay exposes these by id. */
export async function fetchAttachment(
  attachment: { id: string; downloadPath?: string },
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const path = attachment.downloadPath || `/v1/attachments/${attachment.id}`;
  const res = await fetch(`${config.imessageUrl}${path}`, {
    headers: { Authorization: `Bearer ${config.imessageKey}` },
  });
  if (!res.ok) return null;
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || "",
  };
}

export type DeliveryState = "pending" | "delivered" | "failed" | "unknown";

/**
 * What the Mac actually observed. A 202 only means Messages accepted the
 * command; this is the difference between "sent" and "the person got it".
 */
export async function getDelivery(
  requestId: string,
): Promise<{ state: DeliveryState; detail: string }> {
  const res = await fetch(`${config.imessageUrl}/v1/requests/${requestId}`, {
    headers: headers(),
  });
  if (!res.ok) return { state: "unknown", detail: `HTTP ${res.status}` };
  const body = (await res.json()) as any;
  const status = body?.delivery?.status as string | undefined;
  const errorCode = body?.delivery?.errorCode ?? null;

  if (status === "delivered" || status === "read" || status === "sent") {
    return { state: "delivered", detail: status };
  }
  if (status === "failed") return { state: "failed", detail: `errorCode ${errorCode}` };
  if (status === "unconfirmed") return { state: "failed", detail: "unconfirmed" };
  return { state: "pending", detail: String(status ?? "no status") };
}

/** One message's worth of answer, cut on a sentence boundary where possible. */
export function shorten(text: string, max = config.maxReplyChars): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const window = clean.slice(0, max);
  const stop = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (stop > max * 0.5) return window.slice(0, stop + 1).trim();
  const space = window.lastIndexOf(" ");
  return (space > 0 ? window.slice(0, space) : window).replace(/[ ,;:]+$/, "") + "…";
}
