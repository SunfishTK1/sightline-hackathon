"use client";

import { useEffect, useState } from "react";
import type { RankedCandidateView } from "@/lib/market/types";

type BoardData = {
  matchingRunId: string | null;
  candidates: RankedCandidateView[];
};

export function CandidateBoard({ taskId }: { taskId: string }) {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [texting, setTexting] = useState(false);

  async function load() {
    const response = await fetch(`/api/tasks/${taskId}/candidates`);
    const json = await response.json();
    if (!response.ok) {
      throw new Error(json.error ?? "Failed to load candidates");
    }
    setData({
      matchingRunId: json.matchingRunId,
      candidates: json.candidates,
    });
  }

  useEffect(() => {
    load().catch((cause) => setError(cause instanceof Error ? cause.message : "Load failed"));
  }, [taskId]);

  async function runMatch() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? "Matching failed");
      }
      setData({
        matchingRunId: json.run.matchingRunId,
        candidates: json.candidates,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Matching failed");
    } finally {
      setPending(false);
    }
  }

  async function sendTexts() {
    if (!data?.matchingRunId) return;
    setTexting(true);
    setError(null);
    try {
      const response = await fetch(`/api/matching/${data.matchingRunId}/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error ?? "Outreach failed");
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Outreach failed");
    } finally {
      setTexting(false);
    }
  }

  const topFive = data?.candidates.slice(0, 5) ?? [];
  const outreach = new Set(
    (data?.candidates ?? []).slice(0, 3).map((row) => row.worker.uuid),
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Ranked candidates</h2>
          <p className="text-sm text-zinc-600">
            {data?.matchingRunId
              ? `Run ${data.matchingRunId} · top 3 can be texted`
              : "No matching run yet"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={runMatch}
            disabled={pending}
            className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Matching…" : "Run matching"}
          </button>
          <button
            type="button"
            onClick={sendTexts}
            disabled={texting || !data?.matchingRunId}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {texting ? "Sending…" : "Text top 3"}
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {topFive.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 bg-white p-6 text-zinc-600">
          No candidates yet. Run matching to rank eligible workers.
        </p>
      ) : (
        <ol className="space-y-3">
          {topFive.map((row) => (
            <li
              key={row.candidate.candidateId}
              className="rounded-2xl border border-zinc-200 bg-white p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-base font-semibold">
                  #{row.candidate.rank} {row.worker.firstName} {row.worker.lastName}
                </p>
                <p className="font-mono text-sm text-zinc-600">
                  {(row.candidate.scores.final * 100).toFixed(1)} overall
                  {outreach.has(row.worker.uuid) ? " · outreach batch" : ""}
                </p>
              </div>
              <p className="mt-1 text-sm text-zinc-600">{row.worker.preferenceText}</p>
              <dl className="mt-4 grid gap-2 sm:grid-cols-2">
                {scoreLine("Semantic", row.candidate.scores.vector)}
                {scoreLine("Availability", row.candidate.scores.availability)}
                {scoreLine("Price", row.candidate.scores.priceFit)}
                {scoreLine("Reliability", row.candidate.scores.reliability)}
                {scoreLine("Experience", row.candidate.scores.experience)}
                {scoreLine("Location", row.candidate.scores.location)}
              </dl>
              <ul className="mt-3 list-disc pl-5 text-sm text-zinc-700">
                {row.candidate.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function scoreLine(label: string, value: number) {
  return (
    <div key={label}>
      <div className="mb-1 flex justify-between text-xs text-zinc-500">
        <dt>{label}</dt>
        <dd>{(value * 100).toFixed(0)}%</dd>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full bg-zinc-900"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
    </div>
  );
}
