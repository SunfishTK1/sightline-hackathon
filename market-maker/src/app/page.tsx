import Link from "next/link";
import { listTasks } from "@/lib/db/tasks";

export const dynamic = "force-dynamic";

export default async function Home() {
  const tasks = await listTasks();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 bg-zinc-50 px-6 py-12 text-zinc-950">
      <header className="space-y-3">
        <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">
          Sightline · Hours 2–5
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Matching is live
        </h1>
        <p className="max-w-2xl text-lg leading-7 text-zinc-600">
          Eligibility filters, ranking, and candidate write-back are in place.
          Open a task and run matching. Food runs should rank food-run students
          first.
        </p>
      </header>

      <section className="grid gap-4">
        {tasks.map((task) => (
          <Link
            key={task.taskId}
            href={`/tasks/${task.taskId}`}
            className="rounded-2xl border border-zinc-200 bg-white p-6 hover:border-zinc-400"
          >
            <p className="text-sm tracking-wide text-zinc-500 uppercase">
              {task.structured.category.replaceAll("_", " ")}
            </p>
            <h2 className="mt-1 text-xl font-semibold">{task.structured.title}</h2>
            <p className="mt-2 text-zinc-600">{task.structured.description}</p>
            <p className="mt-3 text-sm text-zinc-700">
              ${task.pricing.currentOfferUsd} · {task.status}
            </p>
          </Link>
        ))}
      </section>
    </main>
  );
}
