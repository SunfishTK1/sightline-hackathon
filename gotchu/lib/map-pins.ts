/**
 * @owner Daphne — turn open tasks into outdoor map pins by building name
 */
import type { Task } from "@/lib/types/task";
import { resolveBuilding } from "@/lib/campus-buildings";

export type MapPin = {
  taskId: string;
  title: string;
  priceUsd: number;
  building: string;
  lat: number;
  lng: number;
  pickup?: string;
  dropoff?: string;
};

export function pinForTask(task: Task): MapPin | null {
  const pickup = resolveBuilding(task.structured.pickupLocation);
  const dropoff = resolveBuilding(task.structured.dropoffLocation);
  const place = pickup ?? dropoff;
  if (!place) return null;
  return {
    taskId: task.taskId,
    title: task.structured.title,
    priceUsd: task.agreedPriceUsd ?? task.structured.maxPriceUsd,
    building: place.name,
    lat: place.lat,
    lng: place.lng,
    pickup: task.structured.pickupLocation,
    dropoff: task.structured.dropoffLocation,
  };
}

export function pinsFromTasks(tasks: Task[]): {
  pins: MapPin[];
  unlocated: Task[];
} {
  const pins: MapPin[] = [];
  const unlocated: Task[] = [];
  for (const task of tasks) {
    const pin = pinForTask(task);
    if (pin) pins.push(pin);
    else unlocated.push(task);
  }
  return { pins, unlocated };
}
