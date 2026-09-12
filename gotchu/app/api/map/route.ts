/** @owner Daphne — GET outdoor pins for open campus tasks */
import { NextResponse } from "next/server";
import { MOCK_MAP_OPEN_TASKS } from "@/mocks/map-tasks";
import { pinsFromTasks } from "@/lib/map-pins";
import type { Task } from "@/lib/types/task";

// Always current: the map is pointless if it shows a task someone took an
// hour ago.
export const dynamic = "force-dynamic";

const MARKET = (process.env.MARKET_API_URL || "").replace(/\/$/, "");

type OpenOrder = {
  id: string;
  title: string;
  details: string;
  category: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  budget_usd: string | null;
};

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
      maxPriceUsd: order.budget_usd ? Number(order.budget_usd) : 0,
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
  // Real open tasks when there are any. The demo pins stay as a fallback so an
  // empty marketplace shows a map with something on it rather than a blank
  // one - but the flag says which you are looking at, so nobody mistakes
  // fixtures for live work.
  const live = await liveTasks();
  const demo = !live || live.length === 0;
  const tasks = demo ? MOCK_MAP_OPEN_TASKS : live;

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
