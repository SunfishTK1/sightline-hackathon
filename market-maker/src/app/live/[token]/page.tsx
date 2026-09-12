import { notFound } from "next/navigation";
import { ensureSchema } from "@/lib/db/schema";
import { loadLiveBoard } from "@/lib/db/live";
import { boardWithDeal } from "@/lib/live/deal";
import { LiveBoard } from "./live-board";

export const dynamic = "force-dynamic";

const VOICE_MCP = (process.env.VOICE_MCP_URL || "").replace(/\/$/, "");
const VOICE_MCP_TOKEN = process.env.MCP_AUTH_TOKEN || process.env.VOICE_MCP_AUTH_TOKEN || "";

function voiceHeaders(): Record<string, string> {
  if (!VOICE_MCP_TOKEN) return {};
  return { Authorization: `Bearer ${VOICE_MCP_TOKEN}`, "x-api-key": VOICE_MCP_TOKEN };
}
/** Matches the settlement rate in voice-mcp: 1 railcoin is $1 of task value. */
const RAILCOINS_PER_SOL = 50_000;
/** Someone has taken it, so there is a person to pay. */
const CLOSEABLE = new Set(["accepted", "done_pending"]);

type OrderDetail = {
  pickup_location: string | null;
  dropoff_location: string | null;
  budget_usd: string | null;
  requester_phone: string | null;
  status: string | null;
  payment_status: string | null;
  solana_signature: string | null;
};

/** The board stores no locations, so the task itself is the source for them. */
async function loadOrder(orderId: string): Promise<OrderDetail | null> {
  if (!VOICE_MCP) return null;
  try {
    const res = await fetch(`${VOICE_MCP}/v1/orders/${encodeURIComponent(orderId)}`, {
      headers: voiceHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; data?: OrderDetail };
    return json.ok ? (json.data ?? null) : null;
  } catch {
    return null;
  }
}

type WalletView = {
  railcoins: number | null;
  publicKey: string | null;
  cluster: string | null;
};

async function loadWallet(phone: string | null): Promise<WalletView> {
  const empty = { railcoins: null, publicKey: null, cluster: null };
  if (!VOICE_MCP || !phone) return empty;
  try {
    const res = await fetch(`${VOICE_MCP}/v1/wallets/${encodeURIComponent(phone)}`, {
      headers: voiceHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return empty;
    const json = (await res.json()) as {
      ok?: boolean;
      data?: { balance_sol?: number; public_key?: string; cluster?: string } | null;
    };
    const sol = json.data?.balance_sol;
    return {
      railcoins: typeof sol === "number" ? Math.round(sol * RAILCOINS_PER_SOL) : null,
      publicKey: json.data?.public_key ?? null,
      cluster: json.data?.cluster ?? null,
    };
  } catch {
    return empty;
  }
}

export default async function LivePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await ensureSchema();
  const { token } = await params;
  const raw = await loadLiveBoard(token);
  if (!raw) notFound();
  const board = await boardWithDeal(raw);

  // Neither of these may fail the page: the board is the point, the map and
  // the money are context around it.
  const order = await loadOrder(board.orderId);
  const wallet = await loadWallet(order?.requester_phone ?? null);

  const railcoins = order?.budget_usd ? Math.round(Number(order.budget_usd)) : null;
  const alreadyPaid = Boolean(order?.solana_signature) || order?.payment_status === "paid";
  const needsRetry =
    order?.status === "completed" && !alreadyPaid && Boolean(railcoins && railcoins > 0);

  return (
    <LiveBoard
      token={token}
      initial={board}
      pickup={order?.pickup_location}
      dropoff={order?.dropoff_location}
      money={{
        railcoins,
        requesterBalance: wallet.railcoins,
        publicKey: wallet.publicKey,
        cluster: wallet.cluster,
        canPay: CLOSEABLE.has(order?.status ?? "") || needsRetry,
        alreadyPaid,
        needsRetry,
      }}
    />
  );
}
