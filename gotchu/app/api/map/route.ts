/** @owner Daphne — GET outdoor pins for open campus tasks */
import { NextResponse } from "next/server";
import { MOCK_MAP_OPEN_TASKS } from "@/mocks/map-tasks";
import { pinsFromTasks } from "@/lib/map-pins";
import type { Task } from "@/lib/types/task";

// Always current: the map is pointless if it shows a task someone took an
// hour ago.
export const dynamic = "force-dynamic";

const MARKET = (process.env.MARKET_API_URL || "").replace(/\/$/, "");
const MARKET_TOKEN = process.env.MCP_AUTH_TOKEN || process.env.VOICE_MCP_AUTH_TOKEN || "";

function marketHeaders(): Record<string, string> {
  if (!MARKET_TOKEN) return {};
  return { Authorization: `Bearer ${MARKET_TOKEN}`, "x-api-key": MARKET_TOKEN };
}

type OpenOrder = {
  id: string;
  title: string;
  details: string;
  category: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  budget_usd: string | null;
};

function parseBudgetUsd(value: string | null): number {
  if (!value) return 0;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

/** The live marketplace's shape, mapped onto the one the pin builder wants. */
function asTask(order: OpenOrder): Task {
  const now = new Date().toISOString();
  return {
    taskId: order.id,
    requesterUuid: "",
    rawText: order.details,
    structured: {
      title: order.title,
      description: order.details,
      category: (order.category ?? "other") as Task["structured"]["category"],
      pickupLocation: order.pickup_location ?? undefined,
      dropoffLocation: order.dropoff_location ?? undefined,
      maxPriceUsd: parseBudgetUsd(order.budget_usd),
    } as Task["structured"],
    status: "OPEN",
    matchedWorkerUuid: null,
    agreedPriceUsd: null,
    createdAt: now,
    updatedAt: now,
  } as Task;
}

async function liveTasks(): Promise<Task[] | null> {
  if (!MARKET) return null;
  try {
    const res = await fetch(`${MARKET}/v1/orders/open`, {
      headers: marketHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; data?: OpenOrder[] };
    if (!json.ok || !Array.isArray(json.data)) return null;
    return json.data.map(asTask);
  } catch {
    return null;
  }
}

export async function GET() {
  // Demo pins only when no marketplace is configured. An empty or failed
  // live fetch must not look like real open work.
  const live = await liveTasks();
  const demo = !MARKET;
  const tasks = live && live.length > 0 ? live : demo ? MOCK_MAP_OPEN_TASKS : [];

  const { pins, unlocated } = pinsFromTasks(tasks);
  return NextResponse.json({
    ok: true,
    data: {
      pins,
      unlocated: unlocated.map((t) => ({
        taskId: t.taskId,
        title: t.structured.title,
      })),
      demo,
    },
  });
}
