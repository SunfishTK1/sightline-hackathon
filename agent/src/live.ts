import { config } from "./config.js";

const TIMEOUT_MS = 10 * 60 * 1000;

export async function startLiveBoard(input: {
  orderId: string;
  title: string;
  category?: string | null;
  deadlineAt?: string | null;
  slots?: number;
}): Promise<{ token: string; url: string; created: boolean } | null> {
  const url = `${config.marketMakerUrl}/api/live/start`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`live board start failed: HTTP ${res.status} ${url} ${detail}`.trim());
      return null;
    }
    const body = (await res.json()) as { token: string; url: string; created: boolean };
    if (!body?.url) {
      console.error(`live board start returned no url from ${url}`);
      return null;
    }
    return body;
  } catch (err) {
    console.error(`live board start error at ${url}: ${(err as Error).message}`);
    return null;
  }
}

export async function postLiveEvent(input: {
  orderId: string;
  kind: string;
  message: string;
  slot?: number;
  offerId?: string;
  state?: "queued" | "considering" | "waiting" | "countered" | "declined" | "dropped" | "accepted";
  waitingMinutes?: number;
  addSlot?: boolean;
}): Promise<void> {
  const url = `${config.marketMakerUrl}/api/live/event`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        waitingUntil:
          input.waitingMinutes != null
            ? new Date(Date.now() + input.waitingMinutes * 60_000).toISOString()
            : input.state === "waiting"
              ? new Date(Date.now() + TIMEOUT_MS).toISOString()
              : undefined,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`live event failed: HTTP ${res.status} ${url} ${detail}`.trim());
    }
  } catch (err) {
    console.error(`live event error at ${url}: ${(err as Error).message}`);
  }
}

export async function announceHandoffOnLive(handoff: {
  kind: string;
  order_id?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<void> {
  const orderId =
    handoff.order_id ||
    (typeof handoff.payload?.order_id === "string" ? handoff.payload.order_id : "");
  if (!orderId) return;
  const offerId =
    typeof handoff.payload?.offer_id === "string" ? handoff.payload.offer_id : undefined;
  const asking =
    handoff.payload?.asking_usd != null ? Number(handoff.payload.asking_usd) : null;
  const note =
    typeof handoff.payload?.note === "string" ? handoff.payload.note.trim() : "";
  const timeAsk = /\b(time|later|deadline|tonight|tomorrow|after|hour|minute|when)\b/i.test(
    note,
  );

  if (handoff.kind === "worker_accepted" || handoff.kind === "counter_accepted") {
    await postLiveEvent({
      orderId,
      kind: "accepted",
      message: "Someone took the job.",
      offerId,
      state: "accepted",
    });
    return;
  }
  if (handoff.kind === "counter_received") {
    await postLiveEvent({
      orderId,
      kind: timeAsk && (asking == null || Number.isFinite(asking)) ? "need_time" : "countered",
      message: timeAsk
        ? "They asked for a later time."
        : asking != null && Number.isFinite(asking)
          ? `Counter offer: they asked for $${asking}.`
          : "Counter offer sent.",
      offerId,
      state: "countered",
    });
    return;
  }
  if (handoff.kind === "counter_declined") {
    await postLiveEvent({
      orderId,
      kind: "countered",
      message: "Passed on that price — still waiting on them.",
      offerId,
      state: "waiting",
    });
    return;
  }
  if (handoff.kind === "counter_released" || handoff.kind === "negotiation_cancelled") {
    await postLiveEvent({
      orderId,
      kind: "timeout",
      message:
        handoff.kind === "negotiation_cancelled"
          ? "The back-and-forth was called off. Trying the next person."
          : "Trying the next person.",
      offerId,
      state: "dropped",
    });
    return;
  }
  if (handoff.kind === "question_asked") {
    await postLiveEvent({
      orderId,
      kind: "question_asked",
      message: "They asked a question about the job.",
      offerId,
      state: "waiting",
    });
    return;
  }
  if (handoff.kind === "question_answered") {
    await postLiveEvent({
      orderId,
      kind: "question_answered",
      message: "Question answered. Still waiting to hear back.",
      offerId,
      state: "waiting",
    });
    return;
  }
  if (handoff.kind === "no_takers") {
    await postLiveEvent({
      orderId,
      kind: "stopped",
      message: "Nobody took it, so we paused the search.",
    });
    return;
  }
  if (handoff.kind === "task_cancelled") {
    await postLiveEvent({
      orderId,
      kind: "stopped",
      message: "This job was called off.",
    });
    return;
  }
  if (handoff.kind === "task_done_pending") {
    await postLiveEvent({
      orderId,
      kind: "done_pending",
      message: "They marked the job done. Waiting on confirmation.",
    });
    return;
  }
  if (handoff.kind === "task_completed" || handoff.kind === "payment_sent") {
    await postLiveEvent({
      orderId,
      kind: "paid",
      message:
        handoff.kind === "payment_sent"
          ? "Paid. Railcoins moved."
          : "Confirmed done.",
    });
  }
}

export async function listLiveSkips(): Promise<
  Array<{ token: string; orderId: string; offerId: string | null }>
> {
  try {
    const res = await fetch(`${config.marketMakerUrl}/api/live/skips`);
    if (!res.ok) return [];
    const body = (await res.json()) as {
      skips?: Array<{ token: string; orderId: string; offerId: string | null }>;
    };
    return body.skips ?? [];
  } catch {
    return [];
  }
}

export async function ackLiveSkip(token: string): Promise<void> {
  try {
    await fetch(`${config.marketMakerUrl}/api/live/${token}/ack-skip`, { method: "POST" });
  } catch {
    /* ignore */
  }
}

export async function postLiveMedia(input: {
  orderId: string;
  kind: "image" | "video";
  pngBase64?: string;
  mp4Base64?: string;
  storageKey?: string;
  prompt?: string;
}): Promise<void> {
  try {
    await fetch(`${config.marketMakerUrl}/api/live/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    /* board is optional */
  }
}
