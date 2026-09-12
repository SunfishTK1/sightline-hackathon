import { findCandidateForTaskAndWorker } from "@/lib/db/candidates";
import {
  findLatestOutboundForUser,
  listRecentOutboundForUser,
} from "@/lib/db/messages";
import { findTaskById, listOpenTasksForRequester } from "@/lib/db/tasks";
import type { Message, Task, TaskCandidate, User } from "@/lib/market/types";
import { taskMatchesReply, taskRef } from "@/lib/market/task-ref";

export type InboundRole = "WORKER" | "REQUESTER";

export interface ResolvedThread {
  task: Task;
  role: InboundRole;
  candidate: TaskCandidate | null;
  outbound?: Message;
}

export async function resolveInboundThread(
  user: User,
  rawText: string,
): Promise<
  | { status: "RESOLVED"; thread: ResolvedThread }
  | { status: "AMBIGUOUS"; options: Task[] }
  | { status: "NONE" }
> {
  const outbound = await findLatestOutboundForUser(user.uuid);
  const recent = await listRecentOutboundForUser(user.uuid, 8);
  const requested = await listOpenTasksForRequester(user.uuid);
  const mentionedFromOutbound = (
    await Promise.all(
      recent
        .filter((message) => message.taskId)
        .map(async (message) => {
          const task = await findTaskById(message.taskId!);
          return task && taskMatchesReply(task, rawText) ? task : null;
        }),
    )
  ).filter((task): task is Task => Boolean(task));

  const mentionedRequested = requested.filter((task) =>
    taskMatchesReply(task, rawText),
  );

  if (mentionedFromOutbound[0]) {
    return resolved(user, mentionedFromOutbound[0], outbound ?? undefined);
  }

  if (mentionedRequested.length === 1 && !outbound?.taskId) {
    return {
      status: "RESOLVED",
      thread: {
        task: mentionedRequested[0],
        role: "REQUESTER",
        candidate: null,
      },
    };
  }

  if (outbound?.taskId) {
    const task = await findTaskById(outbound.taskId);
    if (task) {
      const otherActives = requested.filter((item) => item.taskId !== task.taskId);
      const replyLooksLikeRequesterChoice =
        /^(1|2|NO|APPROVE|REJECT)\b/i.test(rawText.trim());
      const lastWasWorkerInvite =
        outbound.purpose === "WORKER_INVITATION" ||
        outbound.purpose === "WORKER_COUNTER" ||
        outbound.purpose === "FINAL_APPROVAL";

      if (
        lastWasWorkerInvite &&
        otherActives.length > 0 &&
        !taskMatchesReply(task, rawText) &&
        mentionedRequested.length > 0
      ) {
        return { status: "AMBIGUOUS", options: [task, ...otherActives] };
      }

      if (replyLooksLikeRequesterChoice && outbound.purpose === "REQUESTER_RELAXATION") {
        return resolved(user, task, outbound);
      }

      return resolved(user, task, outbound);
    }
  }

  if (requested.length === 1) {
    return {
      status: "RESOLVED",
      thread: {
        task: requested[0],
        role: "REQUESTER",
        candidate: null,
      },
    };
  }

  if (requested.length > 1) {
    return { status: "AMBIGUOUS", options: requested };
  }

  return { status: "NONE" };
}

async function resolved(
  user: User,
  task: Task,
  outbound?: Message,
): Promise<{ status: "RESOLVED"; thread: ResolvedThread }> {
  const role: InboundRole =
    outbound?.purpose === "REQUESTER_RELAXATION" ||
    outbound?.purpose === "FINAL_APPROVAL" ||
    (task.requesterUuid === user.uuid && outbound?.purpose !== "WORKER_INVITATION")
      ? "REQUESTER"
      : "WORKER";

  const candidate =
    role === "WORKER"
      ? await findCandidateForTaskAndWorker(task.taskId, user.uuid)
      : null;

  return {
    status: "RESOLVED",
    thread: { task, role, candidate, outbound },
  };
}

export function whichTaskClarification(options: Task[]): string {
  const lines = [
    "Gotchu: I see more than one open job. Which one is this reply for?",
  ];
  options.slice(0, 2).forEach((task, index) => {
    lines.push(
      `${index + 1}) [${taskRef(task)}] ${task.structured.title} ($${task.pricing.currentOfferUsd})`,
    );
  });
  lines.push("Reply 1 or 2.");
  return lines.join(" ");
}

export function workerReplyConfirmation(
  task: Task,
  input: { decision: string; priceUsd?: number; minutes?: number },
): string {
  const ref = taskRef(task);
  if (input.decision === "ACCEPT") {
    return `Gotchu: recorded YES for [${ref}] ${task.structured.title}. Waiting on the requester.`;
  }
  if (input.decision === "DECLINE") {
    return `Gotchu: recorded NO for [${ref}] ${task.structured.title}.`;
  }
  const extras = [
    input.priceUsd != null ? `$${input.priceUsd}` : null,
    input.minutes != null ? `${input.minutes} min` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `Gotchu: recorded COUNTER ${extras} for [${ref}] ${task.structured.title}, not your other open request. Waiting on the requester.`;
}
