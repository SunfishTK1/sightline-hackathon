import { config } from "./config.js";

const TIMEOUT_MS = 10 * 60 * 1000;

export async function startLiveBoard(input: {
  orderId: string;
  title: string;
  category?: string | null;
  deadlineAt?: string | null;
  slots?: number;
}): Promise<{ token: string; url: string; created: boolean } | null> {
  try {
    const res = await fetch(`${config.marketMakerUrl}/api/live/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    return (await res.json()) as { token: string; url: string; created: boolean };
  } catch {
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
  try {
    await fetch(`${config.marketMakerUrl}/api/live/event`, {
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
    });
  } catch {
    /* board is optional */
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
