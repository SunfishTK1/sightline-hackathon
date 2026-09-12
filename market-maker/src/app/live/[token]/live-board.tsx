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

const ASKING: CandidateState[] = ["countered", "waiting", "considering"];

function askingRank(state: CandidateState): number {
  if (state === "countered") return 0;
  if (state === "waiting") return 1;
  if (state === "considering") return 2;
  return 9;
}

function askingSlotOf(
  candidates: Board["candidates"],
): number | undefined {
  const live = candidates
    .filter((candidate) => ASKING.includes(candidate.state))
    .sort((a, b) => askingRank(a.state) - askingRank(b.state) || b.slot - a.slot);
  return live[0]?.slot;
}

type TrackRole = "asking" | "accepted" | "declined" | "next";

function trackRole(
  candidate: Board["candidates"][number],
  askingSlot: number | undefined,
  taken: boolean,
  takenSlot: number | undefined,
): TrackRole {
  if (taken && candidate.slot === takenSlot) return "accepted";
  if (candidate.state === "accepted") return "accepted";
  if (!taken && candidate.slot === askingSlot) return "asking";
  if (
    candidate.state === "declined" ||
    candidate.state === "dropped" ||
    ASKING.includes(candidate.state)
  ) {
    return "declined";
  }
  return "next";
}

function trackLabel(role: TrackRole): string {
  if (role === "asking") return "Asking now";
  if (role === "accepted") return "Accepted";
  if (role === "declined") return "Declined";
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
      className={`h-8 w-8 sm:h-11 sm:w-11 ${faded ? "opacity-40" : ""}`}
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
    needsRetry?: boolean;
  };
}) {
  const [board, setBoard] = useState(initial);
  const [now, setNow] = useState<number | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [deciding, setDeciding] = useState<"accept" | "decline" | "cancel" | null>(null);
  const kind = iconKindFor(board.title, board.category);
  const candidates = board.candidates;
  const accepted = candidates.find((candidate) => candidate.state === "accepted");
  const askingSlot = askingSlotOf(candidates);
  const active = candidates.find((candidate) => candidate.slot === askingSlot);
  const taken =
    board.status === "agreed" ||
    accepted != null ||
    board.events.some((event) => event.kind === "accepted");
  const takenSlot = accepted?.slot ?? (taken ? askingSlot : undefined);
  const onTrack = candidates.filter((candidate) => {
    const role = trackRole(candidate, askingSlot, taken, takenSlot);
    return role !== "declined";
  }).length;

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

  const clock = taken || now == null ? null : remainingLabel(active?.waitingUntil ?? null, now);
  const offerLine = taken
    ? "Someone took the job."
    : active?.state === "countered"
      ? "A counter is on the table. Waiting to hear back."
      : active?.state === "waiting"
        ? "Offer is out. Waiting to hear back."
        : active?.state === "considering"
          ? "Asking someone now."
          : board.headline;

  return (
    <section className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-4 px-3 py-4 text-[#142016] sm:gap-8 sm:px-5 sm:pt-8 sm:pb-14">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1f5c3a] text-white sm:h-8 sm:w-8">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="3" y="10" width="18" height="8" rx="2" fill="currentColor" />
              <rect x="8" y="6" width="6" height="5" rx="1" fill="currentColor" />
              <circle cx="8" cy="19" r="2" fill="currentColor" />
              <circle cx="16" cy="19" r="2" fill="currentColor" />
            </svg>
          </span>
          <p className="text-lg font-semibold tracking-tight sm:text-xl">Gotchu</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="flex items-center justify-end gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-emerald-800 uppercase sm:text-[11px]">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            {taken ? "Taken" : "Live match"}
          </p>
          <p className="mt-1 text-[10px] font-medium tracking-[0.12em] text-zinc-400 uppercase">
            People stay anonymous
          </p>
        </div>
      </header>

      <div className="min-w-0">
        <h1 className="text-xl leading-7 font-semibold tracking-tight break-words sm:text-[1.85rem] sm:leading-8">
          {board.title}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 sm:text-base">{offerLine}</p>
      </div>

      <LiveCampusMap title={board.title} pickup={pickup} dropoff={dropoff} />

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] sm:gap-5">
        <JobClip title={board.title} category={board.category} kind={kind} media={board.media} />

        <section className="min-w-0 overflow-hidden rounded-[20px] border border-[#e7e2d8] bg-white px-3 py-3 sm:rounded-[28px] sm:px-5 sm:py-5">
          <div className="mb-3 flex items-end justify-between gap-2 sm:mb-4">
            <h2 className="text-base font-semibold sm:text-lg">Dispatch track</h2>
            <p className="shrink-0 text-[11px] text-zinc-400 sm:text-xs">
              {onTrack} {onTrack === 1 ? "person" : "people"} on the rail
            </p>
          </div>
          <div className="relative min-w-0 overflow-x-auto px-0.5 pt-1 pb-1 sm:px-1 sm:pt-2">
            <div className="gotchu-track absolute top-[22px] right-3 left-3 sm:top-[30px] sm:right-4 sm:left-4" aria-hidden />
            <ol className="relative flex min-w-0 items-start justify-between gap-1">
              {candidates.map((candidate) => {
                const role = trackRole(candidate, askingSlot, taken, takenSlot);
                const gone = role === "declined";
                const live = role === "asking";
                return (
                  <li
                    key={candidate.slot}
                    className="flex min-w-0 flex-1 flex-col items-center gap-1 sm:gap-2"
                  >
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
                      className={`text-center text-[10px] leading-3 font-semibold sm:text-xs ${
                        gone ? "text-zinc-400" : "text-zinc-800"
                      }`}
                    >
                      {trackLabel(role)}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>
          <p className="mt-3 text-sm text-zinc-500 sm:mt-4">{offerLine}</p>
          {clock ? <p className="mt-1 text-sm text-zinc-500">{clock}</p> : null}
        </section>
      </div>

      <DealPanel
        deal={board.deal}
        status={taken ? "agreed" : board.status}
        deciding={deciding}
        onDecide={decide}
      />

      {money ? (
        <TaskMoney
          token={token}
          railcoins={money.railcoins}
          requesterBalance={money.requesterBalance}
          publicKey={money.publicKey}
          cluster={money.cluster}
          canPay={money.canPay}
          alreadyPaid={money.alreadyPaid}
          needsRetry={money.needsRetry}
        />
      ) : null}

      {board.canSkip && board.status === "matching" && !taken ? (
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
      <section className="rounded-[20px] border border-[#e7e2d8] bg-white px-4 py-3 sm:rounded-[28px] sm:px-5 sm:py-4">
        <p className="text-sm font-semibold">This request is cancelled.</p>
        <p className="mt-1 text-sm text-zinc-500">We stopped looking.</p>
      </section>
    );
  }
  if (status === "agreed") {
    return (
      <section className="rounded-[20px] border border-[#1f5c3a]/25 bg-[#1f5c3a]/5 px-4 py-3 sm:rounded-[28px] sm:px-5 sm:py-4">
        <p className="text-sm font-semibold text-[#1f5c3a]">Someone took the job.</p>
        <p className="mt-1 text-sm text-zinc-600">You&apos;re set — no more matching on this one.</p>
      </section>
    );
  }
  if (!deal) return null;

  const busy = deciding != null;
  const counter = deal.kind === "counter";

  return (
    <section className="rounded-[20px] border border-[#e7e2d8] bg-white px-4 py-4 sm:rounded-[28px] sm:px-5 sm:py-5">
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
  const clipHref = videoReady ? video.url : imageReady ? image.url : null;
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
    <section className="min-w-0 overflow-hidden rounded-[20px] border border-[#e7e2d8] bg-white sm:rounded-[28px]">
      <div className="flex flex-col gap-3 p-3 sm:grid sm:grid-cols-[minmax(0,1fr)_10rem] sm:gap-3 sm:p-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-zinc-400 uppercase">
            {clipLabel}
          </p>
          <h3 className="mt-1 text-base leading-5 font-semibold sm:text-lg sm:leading-6">
            Need a demonstration of the job? Gotchu.
          </h3>
          <p className="mt-1 text-sm text-zinc-500">{title}</p>
          {category ? (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-500 sm:mt-3">
              <TaskIcon kind={kind} color="#5b5348" size={14} />
              {category}
            </p>
          ) : null}
          {clipHref ? (
            <a
              href={clipHref}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f5c3a] underline decoration-[#1f5c3a]/30 underline-offset-2"
            >
              Open clip
            </a>
          ) : null}
        </div>
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-[#eef2ea] sm:aspect-auto sm:min-h-[8rem]">
          {videoReady ? (
            <video
              key={video.url}
              src={video.url ?? undefined}
              poster={image?.url ?? undefined}
              className="h-full w-full object-cover"
              controls
              playsInline
              preload="metadata"
            />
          ) : imageReady ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.url ?? undefined}
              alt={title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className={`flex h-full min-h-[7rem] items-center justify-center text-[#1f5c3a] ${
                drawing ? "live-pulse" : ""
              }`}
              style={{ ["--pulse" as string]: "#1f5c3a" }}
            >
              <TaskIcon kind={kind} color="#1f5c3a" size={36} />
            </div>
          )}
          {clipHref && !videoReady ? (
            <a
              href={clipHref}
              target="_blank"
              rel="noreferrer"
              className="absolute inset-0 flex items-end justify-end p-2"
              aria-label="Open job clip"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-sm text-zinc-800 shadow">
                ▶
              </span>
            </a>
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
