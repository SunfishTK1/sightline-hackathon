"use client";

import { useEffect, useState } from "react";
import { TaskIcon, iconKindFor } from "./task-icon";

type CandidateState =
  | "queued"
  | "considering"
  | "waiting"
  | "countered"
  | "declined"
  | "dropped"
  | "accepted";

type MediaInfo = {
  status: "pending" | "generating" | "ready" | "failed";
  url: string | null;
  progress: number | null;
};

type Board = {
  token: string;
  title: string;
  category: string | null;
  status: "matching" | "agreed" | "stopped";
  headline: string;
  canSkip: boolean;
  candidates: Array<{
    slot: number;
    color: string;
    state: CandidateState;
    waitingUntil: string | null;
  }>;
  events: Array<{
    id: string;
    message: string;
    createdAt: string;
  }>;
  media?: {
    image: MediaInfo;
    video: MediaInfo;
  };
};

function remainingLabel(until: string | null, now: number): string | null {
  if (!until) return null;
  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return "Moving on…";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return "Less than a minute left before we ask the next person.";
  return `${minutes} minutes left to respond before the next person is considered.`;
}

function stateLabel(state: CandidateState): string {
  if (state === "considering") return "Asking now";
  if (state === "waiting") return "Waiting";
  if (state === "countered") return "Counter offer sent";
  if (state === "declined") return "Declined";
  if (state === "dropped") return "Moved on";
  if (state === "accepted") return "Accepted";
  return "Up next";
}

function displayStates(board: Board, elapsedSec: number): CandidateState[] {
  const server = board.candidates.map((candidate) => candidate.state);
  if (board.status !== "matching") return server;
  const progressed = server.some((state) =>
    ["waiting", "countered", "declined", "dropped", "accepted"].includes(state),
  );
  if (progressed) return server;

  const slots = Math.max(server.length, 1);
  const story: CandidateState[] = Array.from({ length: slots }, (_, index) =>
    index === 0 ? "considering" : "queued",
  );
  if (elapsedSec >= 5 && slots > 0) story[0] = "waiting";
  if (elapsedSec >= 10 && slots > 0) story[0] = "countered";
  if (elapsedSec >= 15 && slots > 0) story[0] = "declined";
  if (elapsedSec >= 16 && slots > 1) story[1] = "considering";
  if (elapsedSec >= 21 && slots > 1) story[1] = "waiting";
  return story;
}

export function LiveBoard({ token, initial }: { token: string; initial: Board }) {
  const [board, setBoard] = useState(initial);
  const [now, setNow] = useState<number | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const kind = iconKindFor(board.title, board.category);
  const shown = displayStates(board, elapsedSec);
  const candidates = board.candidates.map((candidate, index) => ({
    ...candidate,
    state: shown[index] ?? candidate.state,
  }));
  const active = candidates.find((candidate) =>
    ["considering", "waiting", "countered"].includes(candidate.state),
  );
  const headline =
    board.status === "matching" &&
    !board.candidates.some((candidate) =>
      ["waiting", "countered", "declined", "dropped", "accepted"].includes(candidate.state),
    )
      ? active?.state === "countered"
        ? "Counter offer sent."
        : active?.state === "waiting"
          ? "Waiting to hear back."
          : "Asking someone now."
      : board.headline;

  useEffect(() => {
    const started = Date.now();
    setNow(started);
    void fetch(`/api/live/${token}/generate`, { method: "POST" })
      .then((response) => (response.ok ? response.json() : null))
      .then((next) => {
        if (next) setBoard(next);
      })
      .catch(() => undefined);
    const tick = window.setInterval(() => {
      const next = Date.now();
      setNow(next);
      setElapsedSec(Math.floor((next - started) / 1000));
    }, 1000);
    const poll = window.setInterval(async () => {
      const response = await fetch(`/api/live/${token}`, { cache: "no-store" });
      if (response.ok) setBoard(await response.json());
    }, 2000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [token]);

  async function skipNow() {
    setSkipping(true);
    try {
      const response = await fetch(`/api/live/${token}/skip`, { method: "POST" });
      if (response.ok) setBoard(await response.json());
    } finally {
      setSkipping(false);
    }
  }

  const clock = now == null ? null : remainingLabel(active?.waitingUntil ?? null, now);

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col gap-8 px-5 py-10 text-zinc-950">
      <header className="space-y-2">
        <p className="text-xs font-medium tracking-[0.18em] text-zinc-500 uppercase">
          Live match
        </p>
        <h1 className="text-2xl font-semibold tracking-normal">{board.title}</h1>
        <p className="text-base text-zinc-600">{headline}</p>
      </header>

      <LiveMedia kind={kind} media={board.media} />

      <ol className="flex flex-wrap items-end justify-center gap-5">
        {candidates.map((candidate) => {
          const live =
            candidate.state === "considering" ||
            candidate.state === "waiting" ||
            candidate.state === "countered";
          const gone =
            candidate.state === "declined" || candidate.state === "dropped";
          return (
            <li
              key={candidate.slot}
              className={`flex w-24 flex-col items-center gap-2 transition-all duration-500 ${
                gone ? "scale-90 opacity-35" : "scale-100 opacity-100"
              }`}
            >
              <div className="relative h-20 w-20">
                {live ? (
                  <span
                    className="live-pulse-ring"
                    style={{ ["--pulse" as string]: candidate.color }}
                  />
                ) : null}
                <div
                  className={`relative flex h-20 w-20 items-center justify-center rounded-2xl border-2 bg-white ${
                    live ? "live-pulse" : ""
                  }`}
                  style={{
                    borderColor: candidate.color,
                    color: candidate.color,
                    ["--pulse" as string]: candidate.color,
                  }}
                >
                  <TaskIcon kind={kind} color={candidate.color} />
                </div>
              </div>
              <p className="text-center text-sm font-bold" style={{ color: candidate.color }}>
                {stateLabel(candidate.state)}
              </p>
            </li>
          );
        })}
      </ol>

      {clock ? <p className="text-center text-sm text-zinc-600">{clock}</p> : null}

      {board.canSkip && board.status === "matching" ? (
        <button
          type="button"
          onClick={() => void skipNow()}
          disabled={skipping}
          className="rounded-full border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-800 disabled:opacity-50"
        >
          Consider the next person now
        </button>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-xs font-medium tracking-[0.18em] text-zinc-500 uppercase">
          Updates
        </h2>
        <ul className="space-y-2">
          {board.events.map((event) => (
            <li key={event.id} className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
              {event.message}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function LiveMedia({
  kind,
  media,
}: {
  kind: ReturnType<typeof iconKindFor>;
  media?: Board["media"];
}) {
  const image = media?.image;
  const video = media?.video;
  const imageReady = image?.status === "ready" && image.url;
  const videoReady = video?.status === "ready" && video.url;
  const drawing =
    !imageReady && (image?.status === "generating" || image?.status === "pending");
  const filming = Boolean(imageReady && !videoReady && video?.status === "generating");
  const label = videoReady
    ? "Job clip"
    : filming
      ? `Filming the job${video?.progress ? ` · ${video.progress}%` : "…"}`
      : drawing
        ? "Drawing the job…"
        : imageReady
          ? "Job picture"
          : null;

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <div className="relative aspect-square w-full bg-zinc-100">
        {videoReady ? (
          <video
            key={video.url}
            src={video.url ?? undefined}
            poster={image?.url ?? undefined}
            className="h-full w-full object-cover"
            autoPlay
            loop
            muted
            playsInline
          />
        ) : imageReady ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.url ?? undefined} alt="" className="h-full w-full object-cover" />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center ${drawing ? "live-pulse" : ""}`}
            style={{ ["--pulse" as string]: "#2563eb" }}
          >
            <TaskIcon kind={kind} color="#2563eb" size={72} />
          </div>
        )}
        {filming || drawing ? (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-4 py-3">
            <p className="text-sm font-medium text-white">{label}</p>
            {filming && video?.progress ? (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/30">
                <div
                  className="h-full bg-white transition-all duration-500"
                  style={{ width: `${video.progress}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {label && !filming && !drawing ? (
        <p className="px-4 py-2 text-xs font-medium tracking-[0.14em] text-zinc-500 uppercase">
          {label}
        </p>
      ) : null}
    </section>
  );
}
