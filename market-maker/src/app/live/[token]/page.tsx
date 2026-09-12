import { notFound } from "next/navigation";
import { ensureSchema } from "@/lib/db/schema";
import { loadLiveBoard } from "@/lib/db/live";
import { resolvePlace } from "@/lib/market/campus-travel";
import { LiveBoard } from "./live-board";
import { TaskMap, type MapPoint } from "./task-map";
import { TaskMoney } from "./task-money";

export const dynamic = "force-dynamic";

const VOICE_MCP = (process.env.VOICE_MCP_URL || "").replace(/\/$/, "");
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
};

/** The board stores no locations, so the task itself is the source for them. */
async function loadOrder(orderId: string): Promise<OrderDetail | null> {
  if (!VOICE_MCP) return null;
  try {
    const res = await fetch(`${VOICE_MCP}/v1/orders/${encodeURIComponent(orderId)}`, {
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

async function loadBalance(phone: string | null): Promise<number | null> {
  if (!VOICE_MCP || !phone) return null;
  try {
    const res = await fetch(`${VOICE_MCP}/v1/wallets/${encodeURIComponent(phone)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; data?: { balance_sol?: number } | null };
    const sol = json.data?.balance_sol;
    return typeof sol === "number" ? Math.round(sol * RAILCOINS_PER_SOL) : null;
  } catch {
    return null;
  }
}

export default async function LivePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await ensureSchema();
  const { token } = await params;
  const board = await loadLiveBoard(token);
  if (!board) notFound();

  // Neither of these may fail the page: the board is the point, the map and
  // the money are context around it.
  const order = await loadOrder(board.orderId);
  const balance = await loadBalance(order?.requester_phone ?? null);

  const points: MapPoint[] = [];
  const pickup = resolvePlace(order?.pickup_location);
  const dropoff = resolvePlace(order?.dropoff_location);
  if (pickup) points.push({ name: pickup.name, lat: pickup.lat, lng: pickup.lng, role: "pickup" });
  if (dropoff && dropoff.name !== pickup?.name) {
    points.push({ name: dropoff.name, lat: dropoff.lat, lng: dropoff.lng, role: "dropoff" });
  }

  const railcoins = order?.budget_usd ? Math.round(Number(order.budget_usd)) : null;

  return (
    <>
      <LiveBoard token={token} initial={board} />
      <div className="mx-auto w-full max-w-5xl px-6 pb-12">
        <TaskMoney
          token={token}
          railcoins={railcoins}
          requesterBalance={balance}
          canPay={CLOSEABLE.has(order?.status ?? "")}
          alreadyPaid={order?.status === "completed"}
        />
        <TaskMap points={points} />
      </div>
    </>
  );
}
