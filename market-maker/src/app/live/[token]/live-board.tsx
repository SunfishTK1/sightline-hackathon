"use client";

import { useEffect, useState } from "react";
import { LiveCampusMap } from "./live-campus-map";
import { TaskIcon, iconKindFor } from "./task-icon";
import { TaskMoney } from "./task-money";

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

type Deal = {
  canCancel: boolean;
  canAccept: boolean;
  canDecline: boolean;
  kind: "counter" | "offer" | null;
  offerId: string | null;
  askingUsd: number | null;
  originalUsd: number | null;
  note: string | null;
};

type Board = {
  token: string;
  title: string;
  category: string | null;
  status: "matching" | "agreed" | "stopped";
  headline: string;
  canSkip: boolean;
  deal?: Deal;
  candidates: Array<{
    slot: number;
    color: string;
    state: CandidateState;
    waitingUntil: string | null;
  }>;
  events: Array<{
    id: string;
    kind?: string;
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
  if (state === "countered") return "Counter sent";
  if (state === "declined") return "Declined";
  if (state === "dropped") return "Moved on";
  if (state === "accepted") return "Accepted";
  return "Up next";
}

function eventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function PersonMark({ color, faded }: { color: string; faded?: boolean }) {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 44 44"
      aria-hidden
      className={faded ? "opacity-40" : ""}
    >
      <circle cx="22" cy="22" r="21" fill="#fff" />
      <circle cx="22" cy="22" r="19" fill={color} opacity="0.16" />
      <circle cx="22" cy="16" r="7" fill={color} />
      <path d="M8 36c2.4-8 9-12 14-12s11.6 4 14 12" fill={color} />
    </svg>
  );
}

export function LiveBoard({
  token,
  initial,
  pickup,
  dropoff,
  money,
}: {
  token: string;
  initial: Board;
  pickup?: string | null;
  dropoff?: string | null;
  money?: {
    railcoins: number | null;
    requesterBalance: number | null;
    publicKey: string | null;
    cluster: string | null;
    canPay: boolean;
    alreadyPaid: boolean;
  };
}) {
  const [board, setBoard] = useState(initial);
  const [now, setNow] = useState<number | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [deciding, setDeciding] = useState<"accept" | "decline" | "cancel" | null>(null);
  const kind = iconKindFor(board.title, board.category);
  const candidates = board.candidates;
  const active = candidates.find((candidate) =>
    ["considering", "waiting", "countered"].includes(candidate.state),
  );
  const onTrack = candidates.filter((candidate) => candidate.state !== "dropped").length;

  useEffect(() => {
    setNow(Date.now());
    void fetch(`/api/live/${token}/generate`, { method: "POST" })
      .then((response) => (response.ok ? response.json() : null))
      .then((next) => {
        if (next) setBoard(next);
      })
      .catch(() => undefined);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
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

  async function decide(action: "accept" | "decline" | "cancel") {
    if (action === "cancel") {
      const sure = window.confirm("Cancel this request? We will stop looking and tell anyone we already asked.");
      if (!sure) return;
    }
    setDeciding(action);
    try {
      const response = await fetch(`/api/live/${token}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (response.ok) setBoard(await response.json());
    } finally {
      setDeciding(null);
    }
  }

  const clock = now == null ? null : remainingLabel(active?.waitingUntil ?? null, now);
  const offerLine =
    active?.state === "countered"
      ? "A counter is on the table. Waiting to hear back."
      : active?.state === "waiting"
        ? "Offer is out. Waiting to hear back."
        : active?.state === "considering"
          ? "Asking someone now."
          : board.headline;

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 pt-8 pb-14 text-[#142016]">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1f5c3a] text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="3" y="10" width="18" height="8" rx="2" fill="currentColor" />
              <rect x="8" y="6" width="6" height="5" rx="1" fill="currentColor" />
              <circle cx="8" cy="19" r="2" fill="currentColor" />
              <circle cx="16" cy="19" r="2" fill="currentColor" />
            </svg>
          </span>
          <p className="text-xl font-semibold tracking-tight">Gotchu</p>
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-1.5 text-[11px] font-semibold tracking-[0.16em] text-emerald-800 uppercase">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            Live match
          </p>
          <p className="mt-1 text-[10px] font-medium tracking-[0.12em] text-zinc-400 uppercase">
            People stay anonymous
          </p>
        </div>
      </header>

      <div>
        <h1 className="text-[1.85rem] leading-8 font-semibold tracking-tight">{board.title}</h1>
        <p className="mt-1 text-base text-zinc-500">{board.headline}</p>
      </div>

      <LiveCampusMap title={board.title} pickup={pickup} dropoff={dropoff} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <JobClip title={board.title} category={board.category} kind={kind} media={board.media} />

        <section className="rounded-[28px] border border-[#e7e2d8] bg-white px-5 py-5">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="text-lg font-semibold">Dispatch track</h2>
            <p className="text-xs text-zinc-400">
              {onTrack} {onTrack === 1 ? "person" : "people"} on the rail
            </p>
          </div>
          <div className="relative px-1 pt-2 pb-1">
            <div className="gotchu-track absolute top-[30px] right-4 left-4" aria-hidden />
            <ol className="relative flex items-start justify-between">
              {candidates.map((candidate) => {
                const gone =
                  candidate.state === "declined" || candidate.state === "dropped";
                const live =
                  candidate.state === "considering" ||
                  candidate.state === "waiting" ||
                  candidate.state === "countered";
                return (
                  <li key={candidate.slot} className="flex w-20 flex-col items-center gap-2">
                    <div
                      className={`relative ${live ? "live-pulse" : ""}`}
                      style={{ ["--pulse" as string]: candidate.color }}
                    >
                      {live ? (
                        <span
                          className="live-pulse-ring !rounded-full"
                          style={{ ["--pulse" as string]: candidate.color }}
                        />
                      ) : null}
                      <PersonMark color={candidate.color} faded={gone} />
                    </div>
                    <p
                      className={`text-center text-xs font-semibold ${
                        gone ? "text-zinc-400" : "text-zinc-800"
                      }`}
                    >
                      {stateLabel(candidate.state)}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>
          <p className="mt-4 text-sm text-zinc-500">{offerLine}</p>
          {clock ? <p className="mt-1 text-sm text-zinc-500">{clock}</p> : null}
        </section>
      </div>

      <DealPanel deal={board.deal} status={board.status} deciding={deciding} onDecide={decide} />

      {money ? (
        <TaskMoney
          token={token}
          railcoins={money.railcoins}
          requesterBalance={money.requesterBalance}
          publicKey={money.publicKey}
          cluster={money.cluster}
          canPay={money.canPay}
          alreadyPaid={money.alreadyPaid}
        />
      ) : null}

      {board.canSkip && board.status === "matching" ? (
        <button
          type="button"
          onClick={() => void skipNow()}
          disabled={skipping}
          className="rounded-full border border-[#d9d3c8] bg-white px-4 py-3.5 text-sm font-medium text-zinc-800 disabled:opacity-50"
        >
          Consider the next person now →
        </button>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="text-lg font-semibold">Live updates</h2>
          <p className="max-w-[9rem] text-right text-[10px] leading-3 font-medium tracking-[0.12em] text-zinc-400 uppercase">
            From texts as they happen
          </p>
        </div>
        <ul className="space-y-3">
          {board.events.map((event) => (
            <li key={event.id} className="flex gap-2 text-sm text-zinc-600">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              <p>
                <span className="text-zinc-400">{eventTime(event.createdAt)}</span>
                {eventTime(event.createdAt) ? " · " : ""}
                {event.message}
              </p>
            </li>
          ))}
        </ul>
        <p className="pt-2 text-[10px] text-zinc-400">
          Stations from{" "}
          <a
            className="underline decoration-zinc-300"
            href="https://github.com/ScottyLabs/maps"
            target="_blank"
            rel="noreferrer"
          >
            CMU Maps
          </a>
          , MIT © 2025 ScottyLabs.
        </p>
      </section>
    </section>
  );
}

function DealPanel({
  deal,
  status,
  deciding,
  onDecide,
}: {
  deal?: Deal;
  status: Board["status"];
  deciding: "accept" | "decline" | "cancel" | null;
  onDecide: (action: "accept" | "decline" | "cancel") => void;
}) {
  if (status === "stopped") {
    return (
      <section className="rounded-[28px] border border-[#e7e2d8] bg-white px-5 py-4">
        <p className="text-sm font-semibold">This request is cancelled.</p>
        <p className="mt-1 text-sm text-zinc-500">We stopped looking.</p>
      </section>
    );
  }
  if (status === "agreed") {
    return (
      <section className="rounded-[28px] border border-[#1f5c3a]/25 bg-[#1f5c3a]/5 px-5 py-4">
        <p className="text-sm font-semibold text-[#1f5c3a]">Someone took the job.</p>
        <p className="mt-1 text-sm text-zinc-600">You&apos;re set — no more matching on this one.</p>
      </section>
    );
  }
  if (!deal) return null;

  const busy = deciding != null;
  const counter = deal.kind === "counter";

  return (
    <section className="rounded-[28px] border border-[#e7e2d8] bg-white px-5 py-5">
      <p className="text-[11px] font-semibold tracking-[0.16em] text-zinc-400 uppercase">
        {counter ? "Counter on the table" : "This offer"}
      </p>
      {counter ? (
        <>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-[#1f5c3a]">
            {deal.askingUsd != null ? `$${deal.askingUsd}` : "New terms"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {deal.originalUsd != null ? `instead of $${deal.originalUsd}` : "They want different terms."}
            {deal.note ? ` · “${deal.note}”` : ""}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-zinc-600">
          {deal.askingUsd != null
            ? `Offered at $${deal.askingUsd}. Waiting to hear back — you can pass or cancel.`
            : "Waiting to hear back. You can pass on this person or cancel the request."}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {deal.canAccept ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide("accept")}
            className="rounded-full bg-[#1f5c3a] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {deciding === "accept" ? "Accepting…" : "Accept"}
          </button>
        ) : null}
        {deal.canDecline ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide("decline")}
            className="rounded-full border border-[#d9d3c8] bg-white px-5 py-2.5 text-sm font-medium text-zinc-800 disabled:opacity-50"
          >
            {deciding === "decline" ? "Passing…" : counter ? "Decline" : "Pass on this person"}
          </button>
        ) : null}
        {deal.canCancel ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide("cancel")}
            className="rounded-full px-5 py-2.5 text-sm font-medium text-[#b3321e] disabled:opacity-50"
          >
            {deciding === "cancel" ? "Cancelling…" : "Cancel request"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function JobClip({
  title,
  category,
  kind,
  media,
}: {
  title: string;
  category: string | null;
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
  const clipLabel = videoReady
    ? "Job clip"
    : filming
      ? `Filming${video?.progress ? ` · ${video.progress}%` : "…"}`
      : drawing
        ? "Drawing…"
        : imageReady
          ? "Job picture"
          : "Job clip";

  return (
    <section className="overflow-hidden rounded-[28px] border border-[#e7e2d8] bg-white">
      <div className="grid grid-cols-[1fr_8rem] gap-3 p-4 sm:grid-cols-[1fr_9.5rem]">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-zinc-400 uppercase">
            {clipLabel}
          </p>
          <h3 className="mt-1 text-lg leading-6 font-semibold">
            Need a demonstration of the job? Gotchu.
          </h3>
          <p className="mt-1 text-sm text-zinc-500">{title}</p>
          {category ? (
            <p className="mt-3 inline-flex items-center gap-1 text-xs text-zinc-500">
              <TaskIcon kind={kind} color="#5b5348" size={14} />
              {category}
            </p>
          ) : null}
        </div>
        <div className="relative overflow-hidden rounded-2xl bg-[#eef2ea]">
          {videoReady ? (
            <video
              key={video.url}
              src={video.url ?? undefined}
              poster={image?.url ?? undefined}
              className="h-full min-h-[8rem] w-full object-cover"
              autoPlay
              loop
              muted
              playsInline
            />
          ) : imageReady ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.url ?? undefined}
              alt=""
              className="h-full min-h-[8rem] w-full object-cover"
            />
          ) : (
            <div
              className={`flex h-full min-h-[8rem] items-center justify-center text-[#1f5c3a] ${
                drawing ? "live-pulse" : ""
              }`}
              style={{ ["--pulse" as string]: "#1f5c3a" }}
            >
              <TaskIcon kind={kind} color="#1f5c3a" size={36} />
            </div>
          )}
          {videoReady || imageReady ? (
            <span className="absolute right-2 bottom-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-xs text-zinc-800">
              ▶
            </span>
          ) : null}
        </div>
      </div>
      {filming && video?.progress ? (
        <div className="h-1 bg-[#efeae1]">
          <div className="h-full bg-[#1f5c3a] transition-all" style={{ width: `${video.progress}%` }} />
        </div>
      ) : null}
    </section>
  );
}
