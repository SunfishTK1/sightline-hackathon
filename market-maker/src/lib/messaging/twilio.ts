import {
  findCandidateById,
  listCandidatesForRun,
  updateCandidate,
} from "@/lib/db/candidates";
import { appendTaskEvent } from "@/lib/db/events";
import { findMessageByProviderId, insertMessage } from "@/lib/db/messages";
import { getState, setState } from "@/lib/db/state";
import { findTaskById } from "@/lib/db/tasks";
import { findUserByPhone, findUserByUuid } from "@/lib/db/users";
import { newId } from "@/lib/ids";
import {
  DEMO_EXPIRATION_SECONDS,
  PROD_EXPIRATION_SECONDS,
} from "@/lib/market/constants";
import type {
  HandleInboundMessage,
  SendCandidateInvitations,
} from "@/lib/market/contracts";
import { parseRequesterSms, parseWorkerSms } from "@/lib/market/parse-sms-response";
import { updateTaskFields } from "@/lib/db/tasks";
import { selectOutreachBatch } from "@/lib/market/send-outreach";
import type { Task, User } from "@/lib/market/types";
import { isLiveMessaging } from "./imessage";
import {
  resolveInboundThread,
  whichTaskClarification,
  workerReplyConfirmation,
} from "./resolve-thread";
import { sendUserMessage } from "./send";
import { workerInvitationText } from "./templates";

export const sendCandidateInvitations: SendCandidateInvitations = async (
  candidateIds,
) => {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() +
      1000 *
        (process.env.DEMO_MODE === "true"
          ? DEMO_EXPIRATION_SECONDS
          : PROD_EXPIRATION_SECONDS),
  );

  for (const candidateId of candidateIds) {
    const candidate = await findCandidateById(candidateId);
    if (!candidate) continue;
    const [worker, task] = await Promise.all([
      findUserByUuid(candidate.workerUuid),
      findTaskById(candidate.taskId),
    ]);
    if (!worker || !task) continue;

    const expiresInLabel =
      process.env.DEMO_MODE === "true" ? "45 sec" : "5 min";
    await sendUserMessage({
      userUuid: worker.uuid,
      phone: worker.phone,
      body: workerInvitationText(task, expiresInLabel),
      purpose: "WORKER_INVITATION",
      taskId: task.taskId,
    });

    await updateCandidate(candidateId, {
      status: "CONTACTED",
      invitation: {
        status: isLiveMessaging() ? "SENT" : "QUEUED",
        sentAt: now,
        expiresAt,
      },
    });
    await appendTaskEvent({
      taskId: task.taskId,
      type: "WORKER_INVITED",
      actor: "MARKET_AGENT",
      metadata: {
        candidateId,
        workerUuid: worker.uuid,
        live: isLiveMessaging(),
      },
    });
  }
};

export async function sendOutreachForRun(runId: string): Promise<string[]> {
  const batch = await selectOutreachBatch(runId);
  const ids =
    batch.length > 0
      ? batch.map((candidate) => candidate.candidateId)
      : (await listCandidatesForRun(runId))
          .filter((candidate) => candidate.status === "SHORTLISTED")
          .slice(0, 3)
          .map((candidate) => candidate.candidateId);
  await sendCandidateInvitations(ids);
  return ids;
}

export const handleInboundMessage: HandleInboundMessage = async (message) => {
  const existing = await findMessageByProviderId(message.providerMessageId);
  if (existing) return;

  const user = await findUserByPhone(message.from);
  if (!user) return;

  const clarified = await applyClarificationChoice(user, message.body);
  const resolved =
    clarified ?? (await resolveInboundThread(user, message.body));

  if (resolved.status === "AMBIGUOUS") {
    await setState(`clarify:${user.uuid}`, {
      taskIds: resolved.options.map((task) => task.taskId),
    });
    await sendUserMessage({
      userUuid: user.uuid,
      phone: user.phone,
      body: whichTaskClarification(resolved.options),
      purpose: "STATUS_UPDATE",
      forceLive: shouldForceLive(user.phone),
    });
    await insertMessage({
      messageId: newId("msg"),
      provider: "IMESSAGE",
      providerMessageId: message.providerMessageId,
      userUuid: user.uuid,
      direction: "INBOUND",
      purpose: "STATUS_UPDATE",
      body: message.body,
      status: "RECEIVED",
      createdAt: message.receivedAt,
    });
    return;
  }

  const thread = resolved.status === "RESOLVED" ? resolved.thread : null;

  await insertMessage({
    messageId: newId("msg"),
    provider: "IMESSAGE",
    providerMessageId: message.providerMessageId,
    userUuid: user.uuid,
    taskId: thread?.task.taskId,
    direction: "INBOUND",
    purpose: thread?.role === "REQUESTER" ? "REQUESTER_RELAXATION" : "WORKER_COUNTER",
    body: message.body,
    status: "RECEIVED",
    createdAt: message.receivedAt,
  });

  if (!thread) {
    return;
  }

  if (thread.role === "REQUESTER") {
    const choice = await parseRequesterSms(message.body);
    const approved = choice.choice === "APPROVE" || /^YES\b/i.test(message.body.trim());
    const rejected = choice.choice === "REJECT" || choice.choice === "NO" || /^NO\b/i.test(message.body.trim());
    if (approved) {
      await updateTaskFields(thread.task.taskId, { status: "ACCEPTED" });
    } else if (rejected) {
      await updateTaskFields(thread.task.taskId, {
        status: "OPEN",
        pricing: {
          ...thread.task.pricing,
          currentOfferUsd: thread.task.pricing.initialOfferUsd,
        },
      });
    }
    await appendTaskEvent({
      taskId: thread.task.taskId,
      type: approved ? "REQUESTER_APPROVED" : "REQUESTER_REJECTED",
      actor: "USER",
      metadata: { rawText: message.body, choice: choice.choice },
    });
    await sendUserMessage({
      userUuid: user.uuid,
      phone: user.phone,
      body: approved
        ? `Gotchu: you agreed to $${thread.task.pricing.currentOfferUsd} for ${thread.task.structured.title}.`
        : `Gotchu: you passed on that offer. Your ${thread.task.structured.title} stays open at $${thread.task.pricing.initialOfferUsd}.`,
      purpose: "STATUS_UPDATE",
      taskId: thread.task.taskId,
      forceLive: shouldForceLive(user.phone),
    });
    return;
  }

  const parsed = await parseWorkerSms(message.body);
  if (thread.candidate) {
    await updateCandidate(thread.candidate.candidateId, {
      status: parsed.decision === "DECLINE" ? "DECLINED" : "INTERESTED",
      invitation: { ...thread.candidate.invitation, status: "RESPONDED" },
      response: {
        decision: parsed.decision,
        priceUsd: parsed.priceUsd,
        estimatedCompletionAt: parsed.estimatedCompletionAt,
        rawText: message.body,
        receivedAt: message.receivedAt,
      },
    });
  }

  await appendTaskEvent({
    taskId: thread.task.taskId,
    type: "WORKER_RESPONDED",
    actor: "PERSONAL_AGENT",
    metadata: {
      candidateId: thread.candidate?.candidateId,
      decision: parsed.decision,
      priceUsd: parsed.priceUsd,
      confidence: parsed.confidence,
      boundBy: "last_outbound_invitation",
    },
  });

  const minutes = parsed.estimatedCompletionAt
    ? Math.round(
        (parsed.estimatedCompletionAt.getTime() - Date.now()) / 60_000,
      )
    : undefined;
  await sendUserMessage({
    userUuid: user.uuid,
    phone: user.phone,
    body: workerReplyConfirmation(thread.task, {
      decision: parsed.decision,
      priceUsd: parsed.priceUsd,
      minutes: minutes && minutes > 0 ? minutes : undefined,
    }),
    purpose: "STATUS_UPDATE",
    taskId: thread.task.taskId,
    forceLive: shouldForceLive(user.phone),
  });
};

function shouldForceLive(phone: string): boolean {
  return isLiveMessaging() || !phone.startsWith("+14125551");
}

async function applyClarificationChoice(user: User, rawText: string) {
  const pending = await getState<{ taskIds: string[] } | null>(
    `clarify:${user.uuid}`,
    null,
  );
  const choice = rawText.trim();
  if (!pending?.taskIds?.length || !/^[12]$/.test(choice)) {
    return null;
  }
  const task = await findTaskById(pending.taskIds[Number(choice) - 1]);
  await setState(`clarify:${user.uuid}`, null);
  if (!task) return null;
  return resolveInboundThread(user, task.structured.title);
}

export async function sendSms(to: string, body: string): Promise<string> {
  const user = await findUserByPhone(to);
  const result = await sendUserMessage({
    userUuid: user?.uuid ?? "unknown",
    phone: to,
    body,
    purpose: "STATUS_UPDATE",
  });
  return result.messageId;
}
