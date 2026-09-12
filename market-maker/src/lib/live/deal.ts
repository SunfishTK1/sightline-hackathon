/**
 * Requester decisions from the public live link.
 *
 * The token is the authorisation, same as paying from this page. Accept and
 * decline only touch the open counter / current offer on this job. Cancel
 * pulls the whole request.
 */
import { loadLiveBoard, recordLiveEvent, type LiveBoardView } from "@/lib/db/live";

const VOICE_MCP = (process.env.VOICE_MCP_URL || "").replace(/\/$/, "");

export type LiveDeal = {
  canCancel: boolean;
  canAccept: boolean;
  canDecline: boolean;
  kind: "counter" | "offer" | null;
  offerId: string | null;
  askingUsd: number | null;
  originalUsd: number | null;
  note: string | null;
};

type OrderRow = {
  status: string | null;
  budget_usd: string | null;
  requester_phone: string | null;
};

type CounterRow = {
  id: string;
  order_id: string;
  counter_price_usd: string | null;
  counter_note: string | null;
  budget_usd: string | null;
};

export const EMPTY_DEAL: LiveDeal = {
  canCancel: false,
  canAccept: false,
  canDecline: false,
  kind: null,
  offerId: null,
  askingUsd: null,
  originalUsd: null,
  note: null,
};

async function voiceGet<T>(path: string): Promise<T | null> {
  if (!VOICE_MCP) return null;
  try {
    const res = await fetch(`${VOICE_MCP}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; data?: T };
    return json.ok ? (json.data ?? null) : null;
  } catch {
    return null;
  }
}

async function voicePost<T>(path: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  if (!VOICE_MCP) return { ok: false, error: "not_configured" };
  try {
    const res = await fetch(`${VOICE_MCP}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: string };
    if (!res.ok || json.ok === false) {
      return { ok: false, error: json.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, data: json.data };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

export async function loadLiveDeal(board: LiveBoardView): Promise<LiveDeal> {
  const matching = board.status === "matching";
  const active = board.candidates.find((candidate) =>
    ["considering", "waiting", "countered"].includes(candidate.state),
  );
  const order = await voiceGet<OrderRow>(`/v1/orders/${encodeURIComponent(board.orderId)}`);
  const phone = order?.requester_phone ?? null;
  const counters = phone
    ? ((await voiceGet<CounterRow[]>(`/v1/counters/open?phone=${encodeURIComponent(phone)}`)) ?? [])
    : [];
  const counter = counters.find((row) => row.order_id === board.orderId) ?? null;
  const originalUsd = order?.budget_usd ? Number(order.budget_usd) : null;
  const cancellable = matching && order?.status !== "completed" && order?.status !== "cancelled";

  if (counter) {
    return {
      canCancel: Boolean(cancellable || matching),
      canAccept: true,
      canDecline: true,
      kind: "counter",
      offerId: String(counter.id),
      askingUsd: counter.counter_price_usd ? Number(counter.counter_price_usd) : null,
      originalUsd,
      note: counter.counter_note,
    };
  }

  return {
    canCancel: Boolean(cancellable || matching),
    canAccept: false,
    canDecline: Boolean(matching && (active?.offerId || active)),
    kind: active ? "offer" : null,
    offerId: active?.offerId ?? null,
    askingUsd: originalUsd,
    originalUsd,
    note: null,
  };
}

export async function decideLiveDeal(
  token: string,
  action: "accept" | "decline" | "cancel",
): Promise<LiveBoardView | null> {
  const board = await loadLiveBoard(token);
  if (!board) return null;
  const deal = await loadLiveDeal(board);

  if (action === "cancel") {
    if (!deal.canCancel) return board;
    await voicePost(`/v1/orders/${encodeURIComponent(board.orderId)}/cancel`, {
      reason: "Cancelled from the live board.",
    });
    return recordLiveEvent({
      token,
      kind: "stopped",
      message: "You cancelled this request.",
    });
  }

  if (action === "accept") {
    if (!deal.canAccept || !deal.offerId) return board;
    const order = await voiceGet<OrderRow>(`/v1/orders/${encodeURIComponent(board.orderId)}`);
    const phone = order?.requester_phone;
    if (!phone) return board;
    const result = await voicePost(`/v1/offers/${encodeURIComponent(deal.offerId)}/counter/respond`, {
      phone,
      accept: true,
    });
    if (!result.ok) return board;
    const amount = deal.askingUsd != null ? ` at $${deal.askingUsd}` : "";
    return recordLiveEvent({
      token,
      kind: "accepted",
      message: `You accepted the counter${amount}. Someone took the job.`,
      offerId: deal.offerId,
      state: "accepted",
    });
  }

  if (action === "decline") {
    if (!deal.canDecline) return board;
    const order = await voiceGet<OrderRow>(`/v1/orders/${encodeURIComponent(board.orderId)}`);
    const phone = order?.requester_phone;
    if (deal.kind === "counter" && deal.offerId && phone) {
      await voicePost(`/v1/offers/${encodeURIComponent(deal.offerId)}/counter/respond`, {
        phone,
        accept: false,
      });
    }
    if (deal.offerId) {
      await voicePost(`/v1/offers/${encodeURIComponent(deal.offerId)}/respond`, { accepted: false });
    }
    return recordLiveEvent({
      token,
      kind: "declined",
      message:
        deal.kind === "counter"
          ? "You turned down that counter. Trying the next person."
          : "You passed on this person. Trying the next person.",
      offerId: deal.offerId,
      state: "declined",
    });
  }

  return board;
}

export async function boardWithDeal(board: LiveBoardView): Promise<LiveBoardView & { deal: LiveDeal }> {
  return { ...board, deal: await loadLiveDeal(board) };
}
