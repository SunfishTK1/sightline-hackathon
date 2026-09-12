/** @owner Claude */
"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TaskHistoryItem, WalletSummary } from "@/lib/history";

type HistoryPayload = {
  requests: TaskHistoryItem[];
  work: TaskHistoryItem[];
  wallet: WalletSummary | null;
};

const STATUS_LABEL: Record<string, string> = {
  submitted: "Looking for someone",
  offered: "Offer sent",
  accepted: "In progress",
  done_marked: "Marked done - awaiting confirmation",
  completed: "Completed",
  blocked: "Declined",
  cancelled: "Cancelled",
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "completed") return "default";
  if (status === "blocked" || status === "cancelled") return "outline";
  return "secondary";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function TaskList({ items, emptyText, counterpartLabel }: {
  items: TaskHistoryItem[];
  emptyText: string;
  counterpartLabel: string;
}) {
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium text-[var(--ink)]">{item.title}</p>
            <p className="text-xs text-muted-foreground">
              {formatDate(item.createdAt)}
              {item.counterpartName ? ` · ${counterpartLabel} ${item.counterpartName}` : ""}
              {item.budgetUsd && Number(item.budgetUsd) > 0
                ? ` · ${Math.round(Number(item.budgetUsd))} railcoins`
                : ""}
            </p>
          </div>
          <Badge variant={statusVariant(item.status)} className="shrink-0">
            {statusLabel(item.status)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function AccountOverview({
  firstName,
  initial,
  onEdit,
}: {
  firstName: string;
  initial: HistoryPayload;
  onEdit: () => void;
}) {
  const [data, setData] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/me/history");
      const json = (await res.json()) as { ok: boolean; data?: HistoryPayload };
      if (json.ok && json.data) setData(json.data);
    } catch {
      // leave the last-known data showing rather than blank the page
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">
          Welcome back{firstName ? `, ${firstName}` : ""}.
        </h2>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Railcoins</CardTitle>
        </CardHeader>
        <CardContent>
          {data.wallet ? (
            <>
              <p className="text-3xl font-semibold text-[var(--ink)]">
                {data.wallet.balanceRailcoins ?? "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.wallet.balanceRailcoins === null
                  ? "Could not reach the network just now - try refreshing."
                  : "Platform credit, usable across tasks."}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your wallet is set up the first time your agent hears from you by text or call.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Things you&apos;ve asked for</CardTitle>
        </CardHeader>
        <CardContent>
          <TaskList
            items={data.requests}
            counterpartLabel="done by"
            emptyText="Nothing yet - text your agent to ask for something."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jobs you&apos;ve done</CardTitle>
        </CardHeader>
        <CardContent>
          <TaskList
            items={data.work}
            counterpartLabel="for"
            emptyText="Nothing yet - tell your agent you're free to pick up work."
          />
        </CardContent>
      </Card>

      <button
        type="button"
        onClick={onEdit}
        className="text-sm underline underline-offset-2 text-muted-foreground hover:text-[var(--ink)]"
      >
        Edit your info
      </button>
    </div>
  );
}
