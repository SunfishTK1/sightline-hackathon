/** @owner Thomas — valid StructuredTask mock for offline build */
import type { StructuredTask } from "@/lib/types/task";

export const MOCK_STRUCTURED_TASK: StructuredTask = {
  title: "Package pickup: UC → Gates",
  category: "pickup",
  pickupLocation: "Cohon University Center",
  dropoffLocation: "Gates Hillman Center",
  deadline: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  maxPriceUsd: 10,
  estimatedMinutes: 25,
  requirements: ["Requester must provide package pickup authorization"],
  inferred: false,
};
