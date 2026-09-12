import { randomBytes } from "crypto";
import { newId } from "@/lib/ids";
import { query } from "./client";

export const CANDIDATE_COLORS = [
  "#2563eb",
  "#d97706",
  "#059669",
  "#db2777",
  "#7c3aed",
  "#0d9488",
];

export type LiveCandidateState =
  | "queued"
  | "considering"
  | "waiting"
  | "countered"
  | "declined"
  | "dropped"
  | "accepted";

export type LiveBoardStatus = "matching" | "agreed" | "stopped";

export interface LiveCandidate {
  slot: number;
  color: string;
  state: LiveCandidateState;
  offerId: string | null;
  waitingUntil: string | null;
}

export interface LiveEvent {
  id: string;
  kind: string;
  message: string;
  slot: number | null;
  createdAt: string;
}

export type LiveMediaStatus = "pending" | "generating" | "ready" | "failed";

export interface LiveMediaInfo {
  status: LiveMediaStatus;
  url: string | null;
  version: number;
  progress: number | null;
}

export interface LiveBoardView {
  token: string;
  url: string;
  orderId: string;
  title: string;
  category: string | null;
  status: LiveBoardStatus;
  offerTimeoutMs: number;
  candidates: LiveCandidate[];
  events: LiveEvent[];
  headline: string;
  canSkip: boolean;
  media: {
    image: LiveMediaInfo;
    video: LiveMediaInfo;
  };
}

function publicBase(): string {
  return (
    process.env.MARKET_MAKER_PUBLIC_URL ||
    process.env.LIVE_BASE_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

function liveUrl(token: string): string {
  return `${publicBase()}/live/${token}`;
}

function newToken(): string {
  return randomBytes(9).toString("base64url");
}


export async function startLiveBoard(input: {
  orderId: string;
  title: string;
  category?: string | null;
  deadlineAt?: string | null;
  slots?: number;
}): Promise<{ token: string; url: string; created: boolean }> {
  const existing = await query<{ token: string }>(
    "SELECT token FROM live_boards WHERE order_id = $1",
    [input.orderId],
  );
  if (existing.rows[0]) {
    // Nothing is forced active here. This runs every ten seconds from the
    // agent's match loop, and it used to flip slot 0 to "considering" with a
    // fresh ten minute clock whenever no slot looked busy - inventing a person
    // deciding on a job nobody had been asked about, and overwriting the real
    // state the agent had just posted. The agent owns these states now.
    await seedLiveMedia(existing.rows[0].token);
    return {
      token: existing.rows[0].token,
      url: liveUrl(existing.rows[0].token),
      created: false,
    };
  }

  const token = newToken();
  const slots = Math.min(6, Math.max(1, input.slots ?? 2));
  await query(
    `INSERT INTO live_boards (token, order_id, title, category, deadline_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      token,
      input.orderId,
      input.title,
      input.category ?? null,
      input.deadlineAt ?? null,
    ],
  );
  // Every slot starts empty. Slot 0 used to be seeded as "considering" with a
  // ten minute clock at the moment the board was created - before a candidate
  // had been chosen, let alone asked - so a board opened straight after a task
  // was submitted showed a phantom person deciding, counting down, with no
  // offer behind them. The real candidate arrives as an event.
  for (let slot = 0; slot < slots; slot += 1) {
    await query(
      `INSERT INTO live_candidates (id, token, slot, color, state, waiting_until)
       VALUES ($1,$2,$3,'queued',NULL)`,
      [newId("lc"), token, slot, CANDIDATE_COLORS[slot % CANDIDATE_COLORS.length]],
    );
  }
  await insertEvent(token, "started", `Looking for someone for "${input.title}".`, null);
  await seedLiveMedia(token);
  return { token, url: liveUrl(token), created: true };
}

async function seedLiveMedia(token: string): Promise<void> {
  for (const kind of ["image", "video"] as const) {
    await query(
      `INSERT INTO live_media (token, kind, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (token, kind) DO NOTHING`,
      [token, kind],
    );
  }
}

async function insertEvent(
  token: string,
  kind: string,
  message: string,
  slot: number | null,
): Promise<void> {
  await query(
    `INSERT INTO live_events (id, token, kind, message, slot)
     VALUES ($1,$2,$3,$4,$5)`,
    [newId("le"), token, kind, message, slot],
  );
}

export async function recordLiveEvent(input: {
  orderId?: string;
  token?: string;
  kind: string;
  message: string;
  slot?: number;
  offerId?: string | null;
  state?: LiveCandidateState;
  waitingUntil?: string | null;
  addSlot?: boolean;
}): Promise<LiveBoardView | null> {
  const token = input.token ?? (await tokenForOrder(input.orderId));
  if (!token) return null;

  let slot = input.slot;
  if (input.addSlot) {
    const count = await query<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM live_candidates WHERE token = $1",
      [token],
    );
    slot = Number(count.rows[0]?.n ?? 0);
    await query(
      `INSERT INTO live_candidates (id, token, slot, color, state)
       VALUES ($1,$2,$3,$4,'queued')
       ON CONFLICT (token, slot) DO NOTHING`,
      [newId("lc"), token, slot, CANDIDATE_COLORS[slot % CANDIDATE_COLORS.length]],
    );
  } else if (slot == null && input.offerId) {
    const found = await query<{ slot: number }>(
      "SELECT slot FROM live_candidates WHERE token = $1 AND offer_id = $2",
      [token, input.offerId],
    );
    slot = found.rows[0]?.slot;
  }

  if (slot != null && input.state) {
    await query(
      `UPDATE live_candidates
       SET state = $3,
           offer_id = COALESCE($4, offer_id),
           waiting_until = $5
       WHERE token = $1 AND slot = $2`,
      [token, slot, input.state, input.offerId ?? null, input.waitingUntil ?? null],
    );
  }

  if (input.state === "accepted") {
    await query(
      `UPDATE live_boards SET status = 'agreed', skip_requested = FALSE, updated_at = NOW()
       WHERE token = $1`,
      [token],
    );
  } else if (input.kind === "stopped") {
    await query(
      `UPDATE live_boards SET status = 'stopped', skip_requested = FALSE, updated_at = NOW()
       WHERE token = $1`,
      [token],
    );
  } else {
    await query("UPDATE live_boards SET updated_at = NOW() WHERE token = $1", [token]);
  }

  await insertEvent(token, input.kind, input.message, slot ?? null);
  return loadLiveBoard(token);
}

export async function requestLiveSkip(token: string): Promise<LiveBoardView | null> {
  const board = await loadLiveBoard(token);
  if (!board || board.status !== "matching" || !board.canSkip) return board;
  await query(
    `UPDATE live_boards SET skip_requested = TRUE, updated_at = NOW() WHERE token = $1`,
    [token],
  );
  await insertEvent(
    token,
    "skip_requested",
    "You asked to consider the next person.",
    currentSlot(board),
  );
  return loadLiveBoard(token);
}

export async function listSkipRequests(): Promise<
  Array<{ token: string; orderId: string; offerId: string | null }>
> {
  const result = await query<{
    token: string;
    order_id: string;
    offer_id: string | null;
  }>(
    `SELECT b.token, b.order_id, c.offer_id
     FROM live_boards b
     LEFT JOIN live_candidates c
       ON c.token = b.token
      AND c.state IN ('considering','waiting','countered')
     WHERE b.skip_requested = TRUE AND b.status = 'matching'
     ORDER BY b.updated_at`,
  );
  return result.rows.map((row) => ({
    token: row.token,
    orderId: row.order_id,
    offerId: row.offer_id,
  }));
}

export async function ackLiveSkip(token: string): Promise<void> {
  await query(
    `UPDATE live_boards SET skip_requested = FALSE, updated_at = NOW() WHERE token = $1`,
    [token],
  );
}

/**
 * The board's status is only ever changed by an event someone remembered to
 * post. Anything that moves the task by another route - the agent restarting
 * mid-match, a worker accepting over text, the requester paying from this very
 * page - leaves the board insisting it is still matching for a job that ended.
 *
 * So the order is treated as the truth and the board is reconciled to it. Only
 * while still matching: once terminal there is nothing left to check, which
 * keeps a two-second poll from hammering voice-mcp forever.
 */
const VOICE_MCP_URL = (process.env.VOICE_MCP_URL || "").replace(/\/$/, "");

const TERMINAL_ORDER_STATUS: Record<string, LiveBoardStatus> = {
  accepted: "agreed",
  done_pending: "agreed",
  completed: "agreed",
  cancelled: "stopped",
  blocked: "stopped",
  no_takers: "stopped",
};

async function reconcileWithOrder(
  token: string,
  orderId: string,
): Promise<LiveBoardStatus | null> {
  if (!VOICE_MCP_URL) return null;
  try {
    const res = await fetch(`${VOICE_MCP_URL}/v1/orders/${encodeURIComponent(orderId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; data?: { status?: string } };
    const next = TERMINAL_ORDER_STATUS[json.data?.status ?? ""];
    if (!next) return null;
    await query(
      `UPDATE live_boards SET status = $2, skip_requested = FALSE, updated_at = NOW()
       WHERE token = $1 AND status = 'matching'`,
      [token, next],
    );
    return next;
  } catch {
    return null;
  }
}

export async function loadLiveBoard(token: string): Promise<LiveBoardView | null> {
  const board = await query<{
    token: string;
    order_id: string;
    title: string;
    category: string | null;
    status: LiveBoardStatus;
    offer_timeout_ms: number;
  }>(
    `SELECT token, order_id, title, category, status, offer_timeout_ms
     FROM live_boards WHERE token = $1`,
    [token],
  );
  const row = board.rows[0];
  if (!row) return null;

  if (row.status === "matching") {
    const reconciled = await reconcileWithOrder(token, row.order_id);
    if (reconciled) row.status = reconciled;
  }

  const candidates = await query<{
    slot: number;
    color: string;
    state: LiveCandidateState;
    offer_id: string | null;
    waiting_until: Date | null;
  }>(
    `SELECT slot, color, state, offer_id, waiting_until
     FROM live_candidates WHERE token = $1 ORDER BY slot`,
    [token],
  );
  const events = await query<{
    id: string;
    kind: string;
    message: string;
    slot: number | null;
    created_at: Date;
  }>(
    `SELECT id, kind, message, slot, created_at
     FROM live_events WHERE token = $1 ORDER BY created_at DESC LIMIT 20`,
    [token],
  );
  const media = await loadMediaInfo(token);

  const view: LiveBoardView = {
    token: row.token,
    url: liveUrl(row.token),
    orderId: row.order_id,
    title: row.title,
    category: row.category,
    status: row.status,
    offerTimeoutMs: row.offer_timeout_ms,
    candidates: candidates.rows.map((candidate) => ({
      slot: candidate.slot,
      color: candidate.color,
      state: candidate.state,
      offerId: candidate.offer_id,
      waitingUntil: candidate.waiting_until?.toISOString() ?? null,
    })),
    events: events.rows.map((event) => ({
      id: event.id,
      kind: event.kind,
      message: event.message,
      slot: event.slot,
      createdAt: event.created_at.toISOString(),
    })),
    media,
    headline: "",
    canSkip: false,
  };
  view.headline = headlineFor(view);
  view.canSkip =
    view.status === "matching" &&
    view.candidates.some((candidate) =>
      ["considering", "waiting", "countered"].includes(candidate.state),
    );
  return view;
}

async function tokenForOrder(orderId?: string): Promise<string | null> {
  if (!orderId) return null;
  const result = await query<{ token: string }>(
    "SELECT token FROM live_boards WHERE order_id = $1",
    [orderId],
  );
  return result.rows[0]?.token ?? null;
}

function currentSlot(board: LiveBoardView): number | null {
  return (
    board.candidates.find((candidate) =>
      ["considering", "waiting", "countered"].includes(candidate.state),
    )?.slot ?? null
  );
}

function headlineFor(board: LiveBoardView): string {
  if (board.status === "agreed") return "Someone took the job.";
  if (board.status === "stopped") return "We stopped looking.";
  const active = board.candidates.find((candidate) =>
    ["considering", "waiting", "countered"].includes(candidate.state),
  );
  if (!active) return "Finding the next person.";
  if (active.state === "countered") return "Counter offer sent.";
  if (active.state === "waiting") return "Waiting to hear back.";
  return "Asking someone now.";
}

function emptyMedia(): LiveMediaInfo {
  return { status: "pending", url: null, version: 0, progress: null };
}

function mediaUrl(token: string, kind: "image" | "video", version: number): string {
  return `/api/live/${token}/${kind}?v=${version}`;
}

async function loadMediaInfo(token: string): Promise<LiveBoardView["media"]> {
  const result = await query<{
    kind: "image" | "video";
    status: LiveMediaStatus;
    progress: number | null;
    updated_at: Date;
    has_bytes: boolean;
  }>(
    `SELECT kind, status, progress, updated_at,
            (bytes IS NOT NULL OR storage_key IS NOT NULL) AS has_bytes
     FROM live_media WHERE token = $1`,
    [token],
  );
  const image = emptyMedia();
  const video = emptyMedia();
  for (const row of result.rows) {
    const version = row.updated_at.getTime();
    const info: LiveMediaInfo = {
      status: row.status,
      url: row.has_bytes ? mediaUrl(token, row.kind, version) : null,
      version,
      progress: row.progress,
    };
    if (row.kind === "image") Object.assign(image, info);
    if (row.kind === "video") Object.assign(video, info);
  }
  return { image, video };
}

export async function getLiveMediaBytes(
  token: string,
  kind: "image" | "video",
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const result = await query<{
    bytes: Buffer | null;
    storage_key: string | null;
    content_type: string | null;
  }>(
    `SELECT bytes, storage_key, content_type FROM live_media
     WHERE token = $1 AND kind = $2`,
    [token, kind],
  );
  const row = result.rows[0];
  if (!row) return null;
  let bytes = row.bytes ?? null;
  if (!bytes && row.storage_key) {
    const { getObject } = await import("@/lib/storage/s3");
    bytes = await getObject(row.storage_key);
  }
  if (!bytes) return null;
  return {
    bytes,
    contentType:
      row.content_type ?? (kind === "video" ? "video/mp4" : "image/png"),
  };
}

export async function attachLiveMedia(input: {
  token?: string;
  orderId?: string;
  kind: "image" | "video";
  bytes?: Buffer;
  storageKey?: string | null;
  contentType: string;
  prompt?: string | null;
}): Promise<LiveBoardView | null> {
  const token = input.token ?? (await tokenForOrder(input.orderId));
  if (!token) return null;
  await seedLiveMedia(token);

  let storageKey = input.storageKey ?? null;
  let bytes = input.bytes ?? null;
  if (!storageKey && bytes) {
    const { putObject, imageKey, videoKey, storageConfigured } = await import(
      "@/lib/storage/s3"
    );
    if (storageConfigured()) {
      const key =
        input.kind === "image"
          ? imageKey(input.orderId ?? token)
          : videoKey(input.orderId ?? token);
      storageKey = await putObject(key, bytes, input.contentType);
      if (storageKey) bytes = null;
    }
  }

  await query(
    `UPDATE live_media
     SET status = 'ready',
         bytes = $3,
         storage_key = $6,
         content_type = $4,
         prompt = COALESCE($5, prompt),
         progress = 100,
         updated_at = NOW()
     WHERE token = $1 AND kind = $2`,
    [
      token,
      input.kind,
      storageKey ? null : bytes,
      input.contentType,
      input.prompt ?? null,
      storageKey,
    ],
  );
  await insertEvent(
    token,
    input.kind === "image" ? "illustration_ready" : "film_ready",
    input.kind === "image" ? "Here's the job picture." : "The job clip is ready.",
    null,
  );
  return loadLiveBoard(token);
}

export async function claimLiveMedia(
  token: string,
  kind: "image" | "video",
): Promise<boolean> {
  await seedLiveMedia(token);
  const result = await query<{ token: string }>(
    `UPDATE live_media
     SET status = 'generating', progress = 0, updated_at = NOW()
     WHERE token = $1 AND kind = $2 AND status IN ('pending', 'failed')
     RETURNING token`,
    [token, kind],
  );
  return Boolean(result.rows[0]);
}

export async function setLiveMediaProgress(
  token: string,
  kind: "image" | "video",
  progress: number,
): Promise<void> {
  await query(
    `UPDATE live_media
     SET progress = $3, updated_at = NOW()
     WHERE token = $1 AND kind = $2 AND status = 'generating'`,
    [token, kind, progress],
  );
}

export async function releaseLiveMedia(
  token: string,
  kind: "image" | "video",
): Promise<void> {
  await query(
    `UPDATE live_media
     SET status = 'pending', progress = NULL, updated_at = NOW()
     WHERE token = $1 AND kind = $2 AND status = 'generating'`,
    [token, kind],
  );
}

export async function markLiveMediaFailed(
  token: string,
  kind: "image" | "video",
): Promise<void> {
  await query(
    `UPDATE live_media
     SET status = 'failed', updated_at = NOW()
     WHERE token = $1 AND kind = $2 AND status = 'generating'`,
    [token, kind],
  );
}

export async function liveBoardJob(token: string): Promise<{
  token: string;
  orderId: string;
  title: string;
  category: string | null;
} | null> {
  const result = await query<{
    token: string;
    order_id: string;
    title: string;
    category: string | null;
  }>(
    `SELECT token, order_id, title, category FROM live_boards WHERE token = $1`,
    [token],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    token: row.token,
    orderId: row.order_id,
    title: row.title,
    category: row.category,
  };
}
