/** @owner Daphne — GET outdoor pins for open campus tasks */
import { NextResponse } from "next/server";
import { MOCK_MAP_OPEN_TASKS } from "@/mocks/map-tasks";
import { pinsFromTasks } from "@/lib/map-pins";

export async function GET() {
  const tasks = MOCK_MAP_OPEN_TASKS;
  const { pins, unlocated } = pinsFromTasks(tasks);
  return NextResponse.json({
    ok: true,
    data: {
      pins,
      unlocated: unlocated.map((t) => ({
        taskId: t.taskId,
        title: t.structured.title,
      })),
      demo: true,
    },
  });
}
