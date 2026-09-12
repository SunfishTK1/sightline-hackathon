import { config } from "./config.js";

/**
 * Thin client over the voice MCP service's REST mirror. Both the phone agent
 * and the voice agent write through it, so one order table serves both.
 */
function voiceHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (config.voiceMcpToken) {
    headers.Authorization = `Bearer ${config.voiceMcpToken}`;
    headers["x-api-key"] = config.voiceMcpToken;
  }
  return headers;
}

async function callTool<T = any>(name: string, input: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${config.voiceMcpUrl}/v1/tools/${name}`, {
    method: "POST",
    headers: voiceHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `tool ${name} failed: HTTP ${res.status}`);
  }
  return body.data as T;
}

export const mcp = {
  identifyCaller: (phone: string) => callTool("identify_caller", { phone }),
  submitOrder: (input: Record<string, unknown>) => callTool("submit_order", input),
  getCall: (callId: string) => callTool("get_call", { call_id: callId }),
  setWorkerProfile: (input: Record<string, unknown>) =>
    callTool("set_worker_profile", input),
  updateOrder: (input: Record<string, unknown>) => callTool("update_order", input),
};

/** One of this person's own requests. */
export type MyOrder = {
  id: string;
  title: string;
  status: string;
  budget_usd: string | null;
};

// ---------------------------------------------------------------- marketplace

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${config.voiceMcpUrl}${path}`, { headers: voiceHeaders() });
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return ((await res.json()) as any).data as T;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.voiceMcpUrl}${path}`, {
    method: "POST",
    headers: voiceHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body ?? {}),
  });
  const parsed = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || parsed.ok === false) {
    throw new Error(parsed.error || `POST ${path}: HTTP ${res.status}`);
  }
  return parsed.data as T;
}

export type OpenJob = {
  id: string;
  order_id: string;
  title: string;
  details: string;
  budget_usd: string | null;
  offered_usd?: string | null;
  deadline_at: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  reason: string | null;
  travel_note?: string | null;
};

export type Outreach = OpenJob & {
  phone: string;
  category: string | null;
  offered_usd?: string | null;
  created_at?: string;
  travel_note?: string | null;
  /** Who asked for the task - needed to look up their likeness consent. */
  requester_phone?: string | null;
};

/** A worker's proposed price, waiting on the requester. */
export type OpenCounter = {
  id: string;
  worker_phone: string;
  counter_price_usd: string | null;
  counter_note: string | null;
  order_id: string;
  title: string;
  budget_usd: string | null;
};

export const market = {
  openOrders: () => get<any[]>("/v1/orders/open"),
  candidates: (orderId: string) => get<any[]>(`/v1/orders/${orderId}/candidates`),
  createOffer: (
    order_id: string,
    phone: string,
    reason: string,
    offered_usd?: number,
    travel_note?: string,
  ) =>
    post<{ id: string } | null>("/v1/offers", {
      order_id,
      phone,
      reason,
      offered_usd,
      travel_note,
    }),
  pendingOutreach: () => get<Outreach[]>("/v1/offers/outreach"),
  markOutreachSent: (id: string) => post(`/v1/offers/${id}/sent`),
  /** A person can be holding several offers at once. */
  openJobs: (phone: string) =>
    get<OpenJob[]>(`/v1/offers/open?phone=${encodeURIComponent(phone)}`),
  respond: (id: string, accepted: boolean, phone?: string) =>
    post<{ status: string }>(`/v1/offers/${id}/respond`, { accepted, phone }),

  /** The broker's price for a live offer. Never the requester's budget. */
  setOfferPrice: (id: string, offered_usd: number) =>
    post<{ id: string; offered_usd: string }>(`/v1/offers/${id}/price`, { offered_usd }),

  counter: (id: string, phone: string, price_usd: number, note?: string) =>
    post<{ status: string }>(`/v1/offers/${id}/counter`, { phone, price_usd, note }),
  respondToCounter: (id: string, phone: string, accept: boolean, release = false) =>
    post<{ status: string }>(`/v1/offers/${id}/counter/respond`, { phone, accept, release }),
  /** Counters waiting on this person's decision, for tasks they asked for. */
  openCounters: (phone: string) =>
    get<OpenCounter[]>(`/v1/counters/open?phone=${encodeURIComponent(phone)}`),

  /** Ask the requester something about a job, on the worker's behalf. */
  askAboutJob: (offerId: string, phone: string, question: string) =>
    post<{ status: string }>(`/v1/offers/${offerId}/question`, { phone, question }),
  answerQuestion: (questionId: string, phone: string, answer: string) =>
    post<{ status: string }>(`/v1/questions/${questionId}/answer`, { phone, answer }),
  questions: (phone: string) =>
    get<{ waiting_on_them: JobQuestion[]; they_asked: JobQuestion[] }>(
      `/v1/questions/open?phone=${encodeURIComponent(phone)}`,
    ),

  /** Completion: the worker says done, the requester confirms. */
  markDone: (orderId: string, phone: string) =>
    post<{ status: string }>(`/v1/orders/${orderId}/done`, { phone }),
  confirmDone: (orderId: string, phone: string, confirmed: boolean, note?: string) =>
    post<{ status: string }>(`/v1/orders/${orderId}/confirm`, { phone, confirmed, note }),
  work: (phone: string) =>
    get<{ doing: WorkItem[]; awaiting_their_confirmation: WorkItem[] }>(
      `/v1/work?phone=${encodeURIComponent(phone)}`,
    ),

  /**
   * Completed tasks with no clip yet. Delivery waits on the relay learning to
   * carry video; until then these are generated and stored.
   */
  /** May we picture this person, and with what. Null when they said no. */
  likeness: (phone: string) =>
    get<{ consented: boolean; has_photo: boolean; avatar_data_url: string | null }>(
      `/v1/people/likeness?phone=${encodeURIComponent(phone)}`,
    ).catch(() => null),

  /** A private link letting someone open their own wallet. */
  walletLink: (phone: string) =>
    post<{ token: string; url: string | null; expires_in_days: number }>(
      "/v1/wallet-links", { phone },
    ),

  /** The matcher looked at this task and picked nobody. */
  noMatch: (orderId: string) =>
    post<{ counted: boolean; parked?: boolean; attempts?: number }>(
      `/v1/orders/${orderId}/no-match`, {},
    ),
  ordersNeedingVideo: () => get<any[]>("/v1/orders/needing-video"),
  /** Records where the clip is. The bytes go to the bucket, not through here. */
  storeOrderVideo: (
    orderId: string,
    video: { storage_key?: string; mp4_base64?: string; bytes?: number },
    prompt: string,
    seconds: string,
  ) => post(`/v1/orders/${orderId}/video`, { ...video, prompt, seconds: Number(seconds) }),
  markVideoDelivered: (orderId: string) => post(`/v1/orders/${orderId}/video/delivered`),
  /** Who is being asked to take this job right now. */
  offerHolders: (orderId: string) =>
    get<Array<{ phone: string; status: string }>>(`/v1/orders/${orderId}/offer-holders`),
  videosPendingDelivery: () => get<any[]>("/v1/videos/pending-delivery"),
  orderVideo: (orderId: string) =>
    get<{ mp4_base64: string | null; storage_key: string | null; bytes: number | null }>(
      `/v1/orders/${orderId}/video`,
    ).catch(() => null),

  /** Tasks with no illustration yet, and the store for them. */
  ordersNeedingImage: () => get<any[]>("/v1/orders/needing-image"),
  storeOrderImage: (
    orderId: string,
    image: { storage_key?: string; png_base64?: string; bytes?: number },
    prompt: string,
  ) => post(`/v1/orders/${orderId}/image`, { ...image, prompt }),
  orderImage: (orderId: string) =>
    get<{ png_base64: string | null; storage_key: string | null; bytes: number | null }>(
      `/v1/orders/${orderId}/image`,
    ).catch(() => null),

  /** Things stuck long enough to be worth chasing. */
  escalations: (staleMinutes: number) =>
    get<Escalation[]>(`/v1/escalations?stale_minutes=${staleMinutes}`),

  /** What each side's agent could act on for its principal. */
  pendingNegotiation: () =>
    get<{ offers: PendingOffer[]; counters: PendingCounter[] }>("/v1/negotiation/pending"),
};

export type Wallet = {
  public_key: string;
  cluster: string;
  funded_at: string | null;
  balance_sol?: number;
};

/**
 * identify_caller already ensures a wallet for everyone the agent talks to;
 * these exist for anything that wants wallet info without a full identify.
 */
export const wallet = {
  ensure: (phone: string) => post<Wallet>("/v1/wallets/ensure", { phone }),
  get: (phone: string) => get<Wallet | null>(`/v1/wallets/${encodeURIComponent(phone)}`),
};

export type WorkItem = {
  id: string;
  title: string;
  status?: string;
  budget_usd: string | null;
  worker_phone?: string;
};

export type Escalation = {
  phone: string;
  name: string | null;
  offer_id?: string;
  question_id?: string;
  reason: "offer_unanswered" | "counter_undecided" | "question_unanswered";
  minutes_waiting: number;
  about: string;
  calling_about: string;
};

export type JobQuestion = {
  id: string;
  question: string;
  answer?: string | null;
  answered_at?: string | null;
  title: string;
  asker_phone?: string;
};

export type PendingOffer = {
  id: string;
  phone: string;
  order_id?: string;
  outreach_sent_at: string;
  title: string;
  budget_usd: string | null;
  offered_usd?: string | null;
  category?: string | null;
  details?: string | null;
  deadline_at?: string | null;
  pickup_location?: string | null;
  dropoff_location?: string | null;
  min_price_usd: string | null;
  auto_counter: boolean | null;
  auto_accept: boolean | null;
  counter_rounds?: number | null;
};

export type PendingCounter = {
  id: string;
  worker_phone: string;
  counter_price_usd: string | null;
  countered_at: string;
  order_id?: string;
  title: string;
  order_budget_usd: string | null;
  offered_usd?: string | null;
  counter_rounds?: number | null;
  requester_phone: string;
};

export type Handoff = {
  id: string;
  phone: string;
  kind: string;
  order_id?: string | null;
  payload: Record<string, any>;
  summary?: string | null;
  resolution?: string | null;
  resolution_status?: string | null;
};

export async function undeliveredHandoffs(): Promise<Handoff[]> {
  const res = await fetch(`${config.voiceMcpUrl}/v1/handoffs?limit=20`, {
    headers: voiceHeaders(),
  });
  if (!res.ok) throw new Error(`handoffs failed: HTTP ${res.status}`);
  const body = (await res.json()) as { data: Handoff[] };
  return body.data ?? [];
}

export async function markHandoffDelivered(id: string): Promise<void> {
  await fetch(`${config.voiceMcpUrl}/v1/handoffs/${id}/delivered`, {
    method: "POST",
    headers: voiceHeaders(),
  });
}
