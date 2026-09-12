/** @owner Daphne — demo OPEN tasks for the campus map when the marketplace URL is unset */
import type { Task } from "@/lib/types/task";

function openTask(
  taskId: string,
  rawText: string,
  structured: Task["structured"],
): Task {
  const now = new Date().toISOString();
  return {
    taskId,
    requesterUuid: "usr_map_demo",
    rawText,
    structured,
    status: "OPEN",
    matchedWorkerUuid: null,
    agreedPriceUsd: null,
    createdAt: now,
    updatedAt: now,
  };
}

export const MOCK_MAP_OPEN_TASKS: Task[] = [
  openTask("tsk_map_burger", "Burger from the UC to Gates, $8 Venmo", {
    title: "Burger from the UC → Gates",
    category: "food",
    pickupLocation: "UC",
    dropoffLocation: "Gates",
    maxPriceUsd: 8,
    estimatedMinutes: 20,
    requirements: ["Pay with Venmo"],
  }),
  openTask("tsk_map_fence", "Paint the Fence white, $40", {
    title: "Paint the Fence white",
    category: "other",
    pickupLocation: "The Fence",
    maxPriceUsd: 40,
    estimatedMinutes: 90,
    requirements: ["white latex, satin finish"],
  }),
  openTask("tsk_map_tazza", "Pick up coffees at Tazza for Gates, $8", {
    title: "Pick up coffees from Tazza",
    category: "food",
    pickupLocation: "Tazza",
    dropoffLocation: "Gates",
    maxPriceUsd: 8,
    estimatedMinutes: 15,
    requirements: ["Pay with Venmo"],
  }),
  openTask("tsk_map_fridge", "Move a mini fridge Morewood to Donner, $25", {
    title: "Move a mini fridge",
    category: "moving",
    pickupLocation: "Morewood",
    dropoffLocation: "Donner",
    maxPriceUsd: 25,
    estimatedMinutes: 40,
  }),
];
