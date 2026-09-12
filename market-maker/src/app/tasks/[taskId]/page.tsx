import Link from "next/link";
import { notFound } from "next/navigation";
import { findTaskById } from "@/lib/db/tasks";
import { CandidateBoard } from "./candidate-board";

export const dynamic = "force-dynamic";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const task = await findTaskById(taskId);
  if (!task) notFound();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 bg-zinc-50 px-6 py-10 text-zinc-950">
      <Link href="/" className="text-sm text-zinc-600 underline">
        All tasks
      </Link>
      <header className="space-y-2">
        <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">
          {task.structured.category.replaceAll("_", " ")} · {task.status}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {task.structured.title}
        </h1>
        <p className="text-zinc-600">{task.structured.description}</p>
        <p className="text-sm text-zinc-700">
          ${task.pricing.currentOfferUsd} · {task.structured.estimatedMinutes} min
          {task.structured.pickupLocation
            ? ` · ${task.structured.pickupLocation} → ${task.structured.dropoffLocation}`
            : null}
        </p>
      </header>
      <CandidateBoard taskId={task.taskId} />
    </main>
  );
}
