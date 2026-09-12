import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "./config.js";
import {
  ensureAgentSchema, getCursor, setCursor, claimEvent, completeEvent, loadTurns,
  saveTurns, pool, getAttempt, recordAttempt, bumpOutreachAttempt,
  recordSent, findSent, bumpNudge, minutesSinceNudge, type Turn,
} from "./db.js";
import { buildNudgeHtml } from "./nudge.js";
import { generateTaskImage } from "./illustrate.js";
import { generateTaskVideo, type FilmableOrder } from "./video.js";
import {
  ensureBucket, putVideo, putImage, getVideo, getImage, storageConfigured,
} from "./storage.js";
import {
  pollEvents, sendText, shorten, fetchAttachment, getDelivery, uploadAttachment,
  type RelayEvent,
} from "./imessage.js";
import { prepareImage } from "./images.js";
import { undeliveredHandoffs, markHandoffDelivered, mcp, market, type Handoff } from "./mcp.js";
import { evaluateDeal } from "./broker.js";
import { pickWorkers } from "./matcher.js";
import { respond } from "./agent.js";
import { learnStyle } from "./style.js";
import {
  ackLiveSkip,
  announceHandoffOnLive,
  listLiveSkips,
  postLiveEvent,
  postLiveChat,
  postLiveMedia,
  startLiveBoard,
} from "./live.js";

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const liveConfirmTries = new Map<string, number>();

function isForUs(event: RelayEvent): boolean {
  if (event.type !== "message.received") return false;
  const sender = event.data.sender ?? "";
  if (config.allowedNumbers.length && !config.allowedNumbers.includes(sender)) return false;
  return !event.data.optOut;
}

async function handleEvent(event: RelayEvent): Promise<void> {
  const phone = event.data.sender!;
  const body = (event.data.body ?? "").trim();
  const attachments = event.data.attachments ?? [];

  if (!body && attachments.length === 0) return;
  if (!(await claimEvent(event.id))) return; // already answered

  // Pull any photos so the model can actually look at them.
  const images: string[] = [];
  const skipped: string[] = [];
  for (const attachment of attachments) {
    const name = attachment.name || attachment.id;
    const file = await fetchAttachment(attachment);
    if (!file) {
      skipped.push(`${name} (download failed)`);
      continue;
    }
    const prepared = await prepareImage(
      file.bytes,
      file.contentType || attachment.mimeType || "",
      name,
    );
    if ("dataUri" in prepared) {
      images.push(prepared.dataUri);
      log(`  read ${name} (${file.bytes.length} bytes)`);
    } else {
      skipped.push(prepared.skipped);
    }
  }

  const text = body || (images.length ? "[sent a photo with no message]" : `[sent ${attachments.length} attachment(s)]`);
  log(`${phone}: ${text.slice(0, 100)}${attachments.length ? ` [+${attachments.length} attachment(s)]` : ""}`);

  const receivedAt = new Date().toISOString();

  // Messages' inline reply tells us exactly which of our messages they are
  // answering. That removes the guesswork behind a bare "yes".
  let replyContext: string | undefined;
  let replyRefId: string | undefined;
  const repliedTo = event.data.inReplyTo?.providerMessageId;
  if (repliedTo) {
    const prior = await findSent(repliedTo).catch(() => null);
    if (prior) {
      replyRefId = prior.ref_id ?? undefined;
      const about = prior.kind === "offer" ? ` (job offer ${prior.ref_id})` : "";
      replyContext = `They used an inline reply on your earlier message${about}: "${prior.text}".`;
      log(`  inline reply to ${prior.kind}${about}`);
    }
  }

  const history = await loadTurns(phone);
  // They may be holding several job offers at once; the agent needs all of them.
  const [openJobs, who, openCounters, questions] = await Promise.all([
    market.openJobs(phone).catch(() => []),
    mcp.identifyCaller(phone).catch(() => null),
    market.openCounters(phone).catch(() => []),
    market.questions(phone).catch(() => ({ waiting_on_them: [], they_asked: [] })),
  ]);
  let reply: string;
  let usedTools: string[] = [];
  let toolTurns: Turn[] = [];
  try {
    const result = await respond(
      phone, text, history, images, skipped, openJobs,
      who?.display_name, who?.recent_orders ?? [], openCounters, replyContext, questions,
      {
        doing: who?.jobs_in_progress ?? [],
        awaitingConfirmation: who?.awaiting_their_confirmation ?? [],
      },
      who?.wallet ?? null,
      history.length === 0,
      who?.style ?? null,
    );
    reply = shorten(result.reply);
    usedTools = result.usedTools;
    toolTurns = result.toolTurns;
  } catch (err) {
    log(`agent error for ${phone}: ${(err as Error).message}`);
    reply = "I hit a snag on my end - say that again and I'll pick it back up.";
  }

  type ChatTarget = { id: string; title?: string; role: "worker" | "requester" };
  let chatTarget: ChatTarget | null = null;
  if (!usedTools.length) {
    const workerTargets: ChatTarget[] = (who?.jobs_in_progress ?? [])
      .filter((order: { id?: string }) => order.id)
      .map((order: { id: string; title?: string }) => ({
        id: String(order.id),
        title: order.title,
        role: "worker" as const,
      }));
    const requesterTargets: ChatTarget[] = [
      ...(who?.open_requests ?? []).filter(
        (order: { id?: string; status: string }) => order.id && order.status === "accepted",
      ),
      ...(who?.awaiting_their_confirmation ?? []),
    ]
      .filter((order: { id?: string }) => order.id)
      .map((order: { id: string; title?: string }) => ({
        id: String(order.id),
        title: order.title,
        role: "requester" as const,
      }));
    const targets = [...workerTargets, ...requesterTargets];
    chatTarget = targets.find((target) => target.id === replyRefId) ?? null;
    if (!chatTarget) {
      const lower = text.toLowerCase();
      const named = targets.filter(
        (target) => target.title && lower.includes(target.title.toLowerCase()),
      );
      if (named.length === 1) chatTarget = named[0];
    }
    if (!chatTarget && targets.length === 1) {
      chatTarget = targets[0];
    } else if (!chatTarget && targets.length > 1) {
      const names = targets.map((target) => `"${target.title ?? target.id}"`).join(", ");
      reply = shorten(`Which job do you mean: ${names}?`);
    }
  }

  const sent = await sendText(phone, reply, `gotchu-${event.id}`);
  await recordSent(sent.requestId, phone, "reply", null, reply);
  log(`-> ${phone} [${usedTools.join(",") || "no tools"}] ${sent.accepted ? "sent" : "FAILED " + sent.detail}: ${reply}`);

  if (sent.accepted || sent.permanent) {
    // Only now is this message truly handled. A failed send leaves the claim
    // stale so a later pass picks it up again.
    await completeEvent(event.id);
  }

  if (sent.accepted) {
    // Tool actions are stored between the question and the answer, so the
    // agent can later recall what it did, not just what it said.
    const updatedHistory = [
      ...history,
      { role: "user", content: text, at: receivedAt } as Turn,
      ...toolTurns,
      { role: "assistant", content: reply, at: new Date().toISOString() } as Turn,
    ];
    await saveTurns(phone, updatedHistory);

    // Re-learn their style every so often, not on every message - it costs
    // two model calls and their style doesn't change message to message.
    if (updatedHistory.length % 8 < 2) {
      learnStyle(phone, updatedHistory).catch(() => {});
    }

    // After someone has taken the job, ordinary texts become the live thread.
    // Tool calls (yes/no, counters) stay off that thread.
    if (!usedTools.length && chatTarget) {
      await postLiveChat({ orderId: chatTarget.id, author: chatTarget.role, body: text });
      await market
        .relayChat(chatTarget.id, text, chatTarget.role === "worker" ? "requester" : "worker")
        .catch(() => null);
    }
  }
}

/**
 * A tapback on one of our messages. Reacting to a job offer is a deliberate
 * act on a specific message, so it carries real intent: a thumbs up is a yes.
 * Anything we cannot tie to a message of ours is just recorded, not answered.
 */
async function handleReaction(event: RelayEvent): Promise<void> {
  const data = event.data;
  const phone = data.sender ?? "";
  if (config.allowedNumbers.length && !config.allowedNumbers.includes(phone)) return;
  if (data.action === "removed") {
    log(`${phone} removed a ${data.kind} reaction`);
    return;
  }
  if (!(await claimEvent(event.id))) return;

  const kind = data.kind === "emoji" ? (data.emoji ?? "emoji") : (data.kind ?? "reaction");
  const prior = data.target?.providerMessageId
    ? await findSent(data.target.providerMessageId).catch(() => null)
    : null;

  const note = prior
    ? `[reacted ${kind} to: "${prior.text.slice(0, 90)}"]`
    : `[reacted ${kind} to a message]`;
  log(`${phone} ${note}`);

  let reply: string | null = null;

  // Requester side: a tapback on a counter-offer notification settles it.
  if (prior?.kind === "counter_received" && prior.ref_id) {
    const pending = (await market.openCounters(phone).catch(() => [])).find(
      (c) => String(c.id) === String(prior.ref_id),
    );
    if (data.kind === "loved" || data.kind === "liked") {
      const result = await market.respondToCounter(prior.ref_id, phone, true).catch(() => null);
      reply = result
        ? "Agreed to that price for you - it's theirs now."
        : "That counter isn't open any more, so I couldn't agree to it.";
      if (result && pending?.order_id) {
        await postLiveEvent({
          orderId: pending.order_id,
          kind: "accepted",
          message: "Someone took the job.",
          offerId: String(prior.ref_id),
          state: "accepted",
        });
      }
    } else if (data.kind === "disliked") {
      const result = await market.respondToCounter(prior.ref_id, phone, false).catch(() => null);
      reply = result
        ? "Turned down that price. The job stays open at what you offered."
        : "That counter isn't open any more.";
      if (result && pending?.order_id) {
        await postLiveEvent({
          orderId: pending.order_id,
          kind: "countered",
          message: "Passed on that price — still waiting on them.",
          offerId: String(prior.ref_id),
          state: "waiting",
        });
      }
    }
  }

  if (!reply && prior?.kind === "offer" && prior.ref_id) {
    const jobs = await market.openJobs(phone).catch(() => []);
    const open = jobs.find((j) => String(j.id) === String(prior.ref_id));

    if (data.kind === "loved" || data.kind === "liked") {
      if (!open) {
        reply = "That job isn't open any more, so I couldn't take it for you.";
      } else {
        const accepted = await market.respond(open.id, true, phone).catch(() => null);
        reply = accepted
          ? `Taking that as a yes on "${open.title}" - it's yours. Text me if you didn't mean that.`
          : "That job isn't open any more, so I couldn't take it for you.";
        if (accepted && open.order_id) {
          await postLiveEvent({
            orderId: open.order_id,
            kind: "accepted",
            message: "Someone took the job.",
            offerId: String(open.id),
            state: "accepted",
          });
        }
      }
    } else if (data.kind === "disliked") {
      if (open) {
        const declined = await market.respond(open.id, false, phone).catch(() => null);
        reply = declined
          ? `Passed on "${open.title}" for you.`
          : "That job isn't open any more, so I couldn't pass on it.";
        if (declined && open.order_id) {
          await postLiveEvent({
            orderId: open.order_id,
            kind: "declined",
            message: "They passed. Trying the next person.",
            offerId: String(open.id),
            state: "declined",
          });
        }
      }
    } else if (data.kind === "questioned") {
      reply = open
        ? `Something unclear about "${open.title}"? Tell me what you want to know and I'll ask them.`
        : null;
    }
  }

  const history = await loadTurns(phone);
  const turns: Turn[] = [
    ...history,
    { role: "user", content: note, at: new Date().toISOString() },
  ];

  if (reply) {
    const sent = await sendText(phone, shorten(reply), `gotchu-reaction-${event.id}`);
    await recordSent(sent.requestId, phone, "reaction_reply", prior?.ref_id ?? null, reply);
    if (sent.accepted) {
      turns.push({ role: "assistant", content: reply, at: new Date().toISOString() });
    }
    log(`-> ${phone} [reaction] ${sent.accepted ? "sent" : "FAILED"}: ${reply}`);
    await saveTurns(phone, turns);
    if (sent.accepted || sent.permanent) {
      await completeEvent(event.id);
    }
    return;
  }
  await saveTurns(phone, turns);
  await completeEvent(event.id);
}

async function pollInbound(): Promise<void> {
  const cursor = await getCursor();
  const { events, nextCursor } = await pollEvents(cursor);
  for (const event of events) {
    try {
      if (event.type === "message.reaction") {
        await handleReaction(event);
      } else if (isForUs(event)) {
        await handleEvent(event);
      }
    } catch (err) {
      log(`handler error on ${event.id}: ${(err as Error).message}`);
    }
  }
  if (nextCursor !== cursor) await setCursor(nextCursor);
}

const MAX_HANDOFF_ATTEMPTS = 3;
const MAX_OUTREACH_ATTEMPTS = 3;

function confirmationLine(handoff: Handoff, url?: string | null): string {
  const price = handoff.payload?.budget_usd;
  const priceText = price && Number(price) > 0 ? ` at $${price}` : "";
  const head = `Your request is in: ${handoff.payload?.title}${priceText}.`;
  if (url) return `${head} Watch it live at: ${url}`;
  return `${head} I'll text you when someone picks it up.`;
}

/** Keep the live URL intact — the usual 320-char cut can slice it off. */
function shortenHandoff(text: string): string {
  const marker = " Watch it live at: ";
  const at = text.lastIndexOf(marker);
  if (at === -1) return shorten(text);
  const url = text.slice(at + marker.length).trim();
  const budget = Math.max(80, config.maxReplyChars - marker.length - url.length);
  return `${shorten(text.slice(0, at), budget)}${marker}${url}`;
}

async function openLiveBoard(order: {
  id: string;
  title: string;
  category?: string | null;
  deadlineAt?: string | null;
  slots?: number;
}): Promise<{ token: string; url: string; created: boolean } | null> {
  return startLiveBoard({
    orderId: order.id,
    title: order.title,
    category: order.category,
    deadlineAt: order.deadlineAt,
    slots: order.slots ?? 3,
  });
}

async function textLiveLink(
  phone: string | null | undefined,
  title: string,
  url: string,
  orderId: string,
): Promise<void> {
  if (!phone || !url) return;
  await sayTo(
    phone,
    `On your "${title}" — already matching. Watch it live: ${url}`,
    `gotchu-live-${orderId}`,
    "agent_action",
    null,
    "SMS",
  );
}

function handoffText(handoff: Handoff): string | null {
  if (handoff.kind === "call_summary") {
    const resolution = handoff.resolution || handoff.payload?.resolution || "";
    return `From your call: ${handoff.payload?.summary || handoff.summary || ""} ${resolution}`.trim();
  }
  if (handoff.kind === "order_confirmation") {
    return confirmationLine(handoff);
  }
  if (handoff.kind === "live_chat") {
    const who = handoff.payload?.from === "worker" ? "They" : "They";
    return `${who} wrote about "${handoff.payload?.title}": ${handoff.payload?.body} Reply here and I'll put it on the live page.`;
  }
  if (handoff.kind === "worker_accepted") {
    return `Someone just took your request: ${handoff.payload?.title}. I'll let you know when it's done.`;
  }
  if (handoff.kind === "counter_received") {
    const was = handoff.payload?.original_usd ? ` instead of $${handoff.payload.original_usd}` : "";
    const note = handoff.payload?.note ? ` They said: "${handoff.payload.note}"` : "";
    const last = handoff.payload?.final_round
      ? " This is the last round - one more counter and the offer is off."
      : "";
    return `Someone will do "${handoff.payload?.title}" for $${handoff.payload?.asking_usd}${was}.${note} Reply YES to agree or NO to pass.${last}`;
  }
  if (handoff.kind === "counter_warning") {
    return `That's ${handoff.payload?.rounds} rounds of haggling on "${handoff.payload?.title}". One more counter from either side and the offer is cancelled.`;
  }
  if (handoff.kind === "negotiation_cancelled") {
    return `Called off the back-and-forth on "${handoff.payload?.title}" after ${handoff.payload?.rounds} rounds. The offer is cancelled for both sides.`;
  }
  if (handoff.kind === "counter_accepted") {
    return `Your price was accepted: "${handoff.payload?.title}" at $${handoff.payload?.agreed_usd}. It's yours.`;
  }
  if (handoff.kind === "task_done_pending") {
    // Say what confirming actually costs, in the unit it is charged in.
    const amount = handoff.payload?.amount_usd
      ? ` Confirming moves ${Math.round(Number(handoff.payload.amount_usd))} railcoins from your wallet to theirs.`
      : "";
    return `"${handoff.payload?.title}" is marked done. Reply YES to confirm, or tell me what's still outstanding.${amount}`;
  }
  if (handoff.kind === "task_completed") {
    const coins = handoff.payload?.railcoins;
    // The money has already moved by the time this is sent, so say so. The old
    // wording said it was "recorded as owed" and told everyone to set up
    // payouts - a Stripe leftover that was never built and never true.
    if (handoff.payload?.paid && coins) {
      // Every simulated worker asked the same two things: how much do I have
      // now, and is there a step left. Answer both, unprompted.
      const bal = handoff.payload?.balance != null ? ` You're at ${handoff.payload.balance}.` : "";
      // "1 railcoin = $1" on its own reads as "this is worth a dollar". It is
      // worth a dollar OF TASK, here, and never converts to money - so say the
      // limit in the same breath as the value.
      return `Confirmed - "${handoff.payload?.title}" is done, and ${coins} railcoins just landed in your wallet.${bal} Railcoins are campus credit: 1 = $1 of task value, spendable on Gotchu only, no cash-out.`;
    }
    if (handoff.payload?.settlement_error) {
      return `Confirmed - "${handoff.payload?.title}" is done, but the ${coins ?? ""} railcoins haven't moved yet. I'm chasing it - you're still owed them.`;
    }
    return `Confirmed - "${handoff.payload?.title}" is done. Thanks for doing it.`;
  }
  if (handoff.kind === "payment_sent") {
    const coins = handoff.payload?.railcoins;
    // Without "you're square", requesters said they would Venmo the worker as
    // well rather than risk having stiffed them - paying twice for one task.
    const bal = handoff.payload?.balance != null ? ` You're at ${handoff.payload.balance}.` : "";
    return `Paid for "${handoff.payload?.title}": ${coins} railcoins went from your wallet to theirs.${bal} You're square - nothing to hand over or Venmo.`;
  }
  if (handoff.kind === "task_disputed") {
    const note = handoff.payload?.note ? ` They said: "${handoff.payload.note}"` : "";
    return `They didn't confirm "${handoff.payload?.title}" as finished.${note} It's back on your list.`;
  }
  if (handoff.kind === "question_asked") {
    return `About "${handoff.payload?.title}" - someone considering it asks: ${handoff.payload?.question} Reply with the answer and I'll pass it straight back.`;
  }
  if (handoff.kind === "question_answered") {
    return `On "${handoff.payload?.title}" you asked: ${handoff.payload?.question} They said: ${handoff.payload?.answer}`;
  }
  if (handoff.kind === "no_takers") {
    return `Nobody has taken "${handoff.payload?.title}" after asking around, so I've paused it rather than keep pestering people. Tell me a different price or looser terms and I'll put it back out.`;
  }
  if (handoff.kind === "task_cancelled") {
    const why = handoff.payload?.reason ? ` (${handoff.payload.reason})` : "";
    return `"${handoff.payload?.title}" was called off${why}, so you're off the hook for it. Nothing owed either way.`;
  }
  if (handoff.kind === "welcome") {
    const who = handoff.payload?.display_name ? `, ${String(handoff.payload.display_name).split(" ")[0]}` : "";
    return `You're in${who}. This is your Gotchu agent. Text me anything you need on campus and I'll find someone to do it, and I'll text you when a job comes up that fits what you said you'd take. Reply STOP any time to stop hearing from me.`;
  }
  if (handoff.kind === "counter_declined") {
    const still = handoff.payload?.still_offered_usd
      ? ` It's still open at $${handoff.payload.still_offered_usd} if you want it.`
      : " It's still open at the original price if you want it.";
    return `They passed on $${handoff.payload?.asked_usd} for "${handoff.payload?.title}".${still}`;
  }
  if (handoff.kind === "counter_released") {
    return `They moved on from your counter on "${handoff.payload?.title}", so I'm asking someone else.`;
  }
  if (handoff.kind === "counter_revised") {
    return `They changed the terms on "${handoff.payload?.title}", so your $${handoff.payload?.asked_usd} counter is no longer pending. I'll send the revised offer separately.`;
  }
  if (handoff.kind === "offer_released") {
    return `They moved on from your offer for "${handoff.payload?.title}", so you're off the hook.`;
  }
  return null;
}

/**
 * The marketplace side: decide who is worth asking about each open task, and
 * put it to them. Several tasks can be in flight at once, and one person can
 * be holding offers on more than one.
 */
async function matchOpenOrders(): Promise<void> {
  for (const order of await market.openOrders()) {
    const live = await openLiveBoard({
      id: order.id,
      title: order.title,
      category: order.category,
      deadlineAt: order.deadline_at,
    });
    if (live?.created) {
      await textLiveLink(order.requester_phone, order.title, live.url, order.id);
    }

    const candidates = await market.candidates(order.id);
    if (!candidates.length) {
      const result = await market.noMatch(String(order.id)).catch(() => null);
      log(
        `no candidates left for "${order.title}"` +
          (result?.parked ? " - parked, requester told" : ""),
      );
      continue;
    }

    const picks = await pickWorkers(order, candidates);
    if (!picks.length) {
      // Count the miss. A task the pool keeps declining gets parked and the
      // requester told, rather than retried every twenty seconds in silence.
      const result = await market.noMatch(String(order.id)).catch(() => null);
      log(
        `no suitable worker for "${order.title}" among ${candidates.length} available` +
          (result?.parked ? " - parked, requester told" : ""),
      );
      continue;
    }
    const pick = picks[0];
    if (!pick) continue;
    const travelNote = pick.travel
      ? `${pick.travel.line}. ~${pick.travel.totalMin} min door to done.`
      : undefined;
    const offer = await market
      .createOffer(
        order.id,
        pick.phone,
        pick.reason,
        pick.offerUsd,
        travelNote,
      )
      .catch((err) => {
        // Candidate data can go stale between ranking and the locked write.
        // One raced order must not abort matching every other open request.
        log(`could not offer "${order.title}" to ${pick.phone}: ${(err as Error).message}`);
        return null;
      });
    if (offer) {
      log(`offered "${order.title}" to ${pick.phone} at $${pick.offerUsd ?? "?"} pDeal=${pick.pDeal ?? "?"}: ${pick.reason}`);
      const offerId = String((offer as { id?: string }).id ?? "");
      // Picked, but not asked: outreach holds the text until the picture and
      // the film exist, which can be minutes. Saying "considering" here put a
      // countdown against someone who had not been messaged - and if the
      // assets never arrived, the slot ran out having contacted nobody.
      await postLiveEvent({
        orderId: order.id,
        kind: "queued",
        message: live && !live.created ? "Lining up the next person." : "Lining someone up.",
        offerId,
        state: "queued",
        addSlot: Boolean(live && !live.created),
        slot: live && !live.created ? undefined : 0,
      });
      if (order.requester_phone && pick.offerUsd != null) {
        const hop = pick.travel
          ? ` ${pick.travel.distanceMi} mi: walk ${pick.travel.walkMin} min, bus ${pick.travel.busMin} min, drive ${pick.travel.driveMin} min.`
          : "";
        const timeWarn =
          pick.travel?.feasibility === "INFEASIBLE"
            ? " That deadline looks short for the hop — want a later time?"
            : pick.travel?.feasibility === "TIGHT"
              ? " It's tight on time."
              : "";
        await sayTo(
          order.requester_phone,
          `I'll ask someone for "${order.title}" at $${pick.offerUsd} — typical for this job.${hop}${timeWarn} Reply if you want a different cap or more time.`,
          `gotchu-prime-${order.id}-${pick.offerUsd}`,
        );
        if (live?.url) {
          await textLiveLink(order.requester_phone, order.title, live.url, order.id);
        }
      }
    }
  }
}

/** Text each pending offer to the person it was made to. */
async function sendOutreach(): Promise<void> {
  for (const offer of await market.pendingOutreach()) {
    const offerUsd = offer.offered_usd ?? offer.budget_usd;
    const pay = offerUsd && Number(offerUsd) > 0
      ? `$${offerUsd}`
      : "price open";
    const due = offer.deadline_at
      ? ` by ${new Date(offer.deadline_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
      : "";
    const call = config.voiceCallNumber
      ? `, or call ${config.voiceCallNumber} to talk it through`
      : "";
    const hop = offer.travel_note ? ` ${offer.travel_note}` : "";
    const text = `Job for you: ${offer.title} (${pay} — typical for this job)${due}.${hop} Can you make that? Reply YES, NO, or say you need more time${call}.`;

    const attempt = await bumpOutreachAttempt(offer.id);
    // The relay requires an 8-128 char key; a bare "offer-1" is too short and
    // is rejected outright.
    const key = `gotchu-offer-${offer.id}-attempt-${attempt}`;
    // Send now. Holding for the illustration left the live board up with
    // nobody actually asked, and films are a separate paid request anyway.
    const orderId = String(offer.order_id ?? "");
    const png = await imageFor(orderId);

    const attachments: string[] = [];
    if (png) {
      const id = await uploadAttachment(png, "image/png");
      if (id) attachments.push(id);
    }
    if (!png) {
      log(`offer ${offer.id} going out without a picture`);
    }

    const message = shorten(text);
    const sent = await sendText(offer.phone, message, key, attachments);
    await recordSent(sent.requestId, offer.phone, "offer", String(offer.id), message);

    if (sent.accepted) {
      const marked = await market.markOutreachSent(offer.id).catch(() => null);
      if (!marked) {
        log(`outreach offer ${offer.id} landed after it was no longer live`);
        continue;
      }
      // Only make the delivered offer actionable in the conversation after
      // the marketplace has made it actionable through openJobs too.
      const history = await loadTurns(offer.phone);
      await saveTurns(offer.phone, [
        ...history,
        { role: "assistant", content: message, at: new Date().toISOString() },
      ]);
      if (offer.order_id) {
        await postLiveEvent({
          orderId: offer.order_id,
          kind: "waiting",
          message: "Asked them - waiting to hear back.",
          offerId: String(offer.id),
          // live.ts starts the ten-minute clock on "waiting", which is now
          // the first moment they have actually been asked.
          state: "waiting",
        });
      }
      log(`outreach offer ${offer.id} -> ${offer.phone}: ${sent.detail}`);
      continue;
    }
    if (sent.permanent || attempt >= MAX_OUTREACH_ATTEMPTS) {
      // They never got the text. A permanent failure cannot become actionable;
      // release it immediately instead of starting an exclusive waiting clock.
      const released = await market.respond(offer.id, false).catch(() => null);
      if (released && offer.order_id) {
        // recordNoMatch refuses to count while another live offer or counter
        // exists, which is expected during a volunteer overlap.
        await market.noMatch(String(offer.order_id)).catch(() => null);
        await postLiveEvent({
          orderId: offer.order_id,
          kind: "timeout",
          message: "Could not deliver the offer. Trying the next person.",
          offerId: String(offer.id),
          state: "dropped",
        });
      }
      log(
        released
          ? `outreach offer ${offer.id} RELEASED after ${attempt} failed attempt(s) to ${offer.phone}: ${sent.detail}`
          : `outreach offer ${offer.id} changed before give-up could release it`,
      );
      continue;
    }
    log(`outreach offer ${offer.id} attempt ${attempt} failed: ${sent.detail}`);
  }
}

/**
 * Text people what happened on their voice call. A handoff is only closed once
 * the Mac has observed the message land - a 202 is not delivery, and treating
 * it as delivery silently loses summaries.
 */
async function deliverHandoffs(): Promise<void> {
  for (const handoff of await undeliveredHandoffs()) {
    let text = handoffText(handoff);
    if (handoff.kind === "order_confirmation") {
      const orderId = handoff.order_id ?? handoff.payload?.order_id;
      let liveUrl =
        typeof handoff.payload?.live_url === "string" && handoff.payload.live_url
          ? handoff.payload.live_url
          : null;
      if (orderId) {
        const live = await openLiveBoard({
          id: String(orderId),
          title: String(handoff.payload?.title ?? "Your request"),
          category: handoff.payload?.category ?? null,
          deadlineAt: handoff.payload?.deadline_at ?? null,
        });
        liveUrl = live?.url ?? liveUrl;
      }
      if (liveUrl) {
        text = confirmationLine(handoff, liveUrl);
        liveConfirmTries.delete(handoff.id);
      } else {
        const tries = (liveConfirmTries.get(handoff.id) ?? 0) + 1;
        liveConfirmTries.set(handoff.id, tries);
        log(`holding confirmation ${handoff.id} for a live url (try ${tries}/4)`);
        if (tries < 4) continue;
      }
    }
    if (!text) continue;

    // A handoff aimed at a malformed number can never be delivered; retrying
    // it forever just hammers the relay.
    if (!/^\+\d{10,15}$/.test(handoff.phone ?? "")) {
      await markHandoffDelivered(handoff.id);
      log(`handoff ${handoff.id} dropped: unusable target "${handoff.phone}"`);
      continue;
    }

    const prior = await getAttempt(handoff.id);

    // A send is outstanding: ask what actually happened to it.
    if (prior?.request_id) {
      const { state, detail } = await getDelivery(prior.request_id);
      if (state === "delivered") {
        await announceHandoffOnLive(handoff);
        await markHandoffDelivered(handoff.id);
        log(`handoff ${handoff.id} (${handoff.kind}) -> ${handoff.phone}: ${detail}`);
        const history = await loadTurns(handoff.phone);
        await saveTurns(handoff.phone, [
          ...history,
          { role: "assistant", content: text, at: new Date().toISOString() },
        ]);
        continue;
      }
      if (state === "pending") continue; // still in flight, look again next pass
      log(`handoff ${handoff.id} did not land (${detail}), attempt ${prior.attempts}`);
      if (prior.attempts >= MAX_HANDOFF_ATTEMPTS) {
        await markHandoffDelivered(handoff.id);
        log(`handoff ${handoff.id} GIVING UP after ${prior.attempts} attempts to ${handoff.phone}: ${detail}`);
        continue;
      }
    }

    // A send that never even got accepted also has to stop. The check above
    // only fires once a requestId exists, so a rejected send needs its own cap.
    if ((prior?.attempts ?? 0) >= MAX_HANDOFF_ATTEMPTS) {
      await markHandoffDelivered(handoff.id);
      log(`handoff ${handoff.id} GIVING UP after ${prior?.attempts} failed sends: ${prior?.last_error}`);
      continue;
    }

    const attemptNo = (prior?.attempts ?? 0) + 1;
    // A retry needs a fresh key: replaying the old one returns the original
    // response and sends nothing.
    const outbound = shortenHandoff(text);
    const sent = await sendText(handoff.phone, outbound, `handoff-${handoff.id}-a${attemptNo}`);
    // A counter notification has to remember the offer, not the order: that is
    // what answering it needs.
    const refId = handoff.kind === "counter_received"
      ? String(handoff.payload?.offer_id ?? "")
      : String(handoff.order_id ?? "");
    await recordSent(sent.requestId, handoff.phone, handoff.kind, refId, outbound);

    if (sent.permanent) {
      await markHandoffDelivered(handoff.id);
      log(`handoff ${handoff.id} closed without sending (${sent.detail})`);
      continue;
    }
    await recordAttempt(handoff.id, sent.requestId ?? null, sent.accepted ? null : sent.detail);
    log(`handoff ${handoff.id} attempt ${attemptNo} -> ${handoff.phone}: ${sent.detail}`);
  }
}

/** Send as the agent and record it, so the thread stays the whole story. */
async function sayTo(
  phone: string,
  text: string,
  key: string,
  kind = "agent_action",
  refId: string | null = null,
  service: "iMessage" | "SMS" | "auto" = "iMessage",
): Promise<boolean> {
  const message = shorten(text);
  const sent = await sendText(phone, message, key, undefined, service);
  await recordSent(sent.requestId, phone, kind, refId, message);
  if (sent.accepted) {
    const history = await loadTurns(phone);
    await saveTurns(phone, [
      ...history,
      { role: "assistant", content: message, at: new Date().toISOString() },
    ]);
  }
  return sent.accepted;
}

async function applyLiveSkips(): Promise<void> {
  for (const skip of await listLiveSkips()) {
    // A board/candidate race can briefly produce no active offer. Keep the
    // request set until there is something concrete to release.
    if (!skip.offerId) continue;
    const order = await market.getOrder(skip.orderId).catch(() => null);
    const phone = order?.requester_phone;
    const counters = phone ? await market.openCounters(phone).catch(() => []) : [];
    const countered = counters.find((c) => String(c.id) === String(skip.offerId));
    let released = false;
    if (countered && phone) {
      released = Boolean(
        await market.respondToCounter(skip.offerId, phone, false, true).catch(() => null),
      );
    } else {
      released = Boolean(await market.respond(skip.offerId, false).catch(() => null));
    }
    // Keep skip_requested set when the marketplace release fails so the
    // next poll retries instead of showing a drop that never happened.
    if (!released) continue;
    await postLiveEvent({
      orderId: skip.orderId,
      kind: "skipped",
      message: "You asked to move on. Trying the next person.",
      offerId: skip.offerId,
      state: "dropped",
    });
    await ackLiveSkip(skip.token);
  }
}

const EXCLUSIVE_OFFER_TIMEOUT_MS = 10 * 60 * 1000;

/** One exclusive worker at a time: silence for 10 minutes means try the next pick. */
async function expireStaleOffers(): Promise<void> {
  const { offers, counters } = await market.pendingNegotiation();
  const now = Date.now();

  for (const offer of offers) {
    if (!offer.outreach_sent_at) continue;
    if (now - new Date(offer.outreach_sent_at).getTime() < EXCLUSIVE_OFFER_TIMEOUT_MS) continue;
    try {
      const verdict = await evaluateDeal({
        order: { title: offer.title, budget_usd: offer.budget_usd, category: offer.category },
        current_offer_usd: Number(offer.offered_usd ?? offer.budget_usd ?? 0),
        decision: "TIMEOUT",
      });
      if (verdict && verdict.action !== "TRY_NEXT") continue;
      await market.respond(offer.id, false);
      if (offer.order_id) {
        await postLiveEvent({
          orderId: offer.order_id,
          kind: "timeout",
          message: "No reply in time. Trying the next person.",
          offerId: String(offer.id),
          state: "dropped",
        });
      }
      log(`timed out offer ${offer.id} for ${offer.phone}`);
    } catch (err) {
      log(`timeout failed on offer ${offer.id}: ${(err as Error).message}`);
    }
  }

  for (const counter of counters) {
    if (now - new Date(counter.countered_at).getTime() < EXCLUSIVE_OFFER_TIMEOUT_MS) continue;
    try {
      const verdict = await evaluateDeal({
        order: { title: counter.title, budget_usd: counter.order_budget_usd },
        current_offer_usd: Number(counter.offered_usd ?? counter.order_budget_usd ?? 0),
        decision: "TIMEOUT",
      });
      if (verdict && verdict.action !== "TRY_NEXT") continue;
      await market.respondToCounter(counter.id, counter.requester_phone, false, true);
      if (counter.order_id) {
        await postLiveEvent({
          orderId: counter.order_id,
          kind: "timeout",
          message: "No decision in time. Trying the next person.",
          offerId: String(counter.id),
          state: "dropped",
        });
      }
      await sayTo(
        counter.requester_phone,
        `No decision on "${counter.title}" in time, so I'm asking someone else.`,
        `gotchu-timeout-counter-${counter.id}`,
      );
      log(`timed out counter ${counter.id} for ${counter.requester_phone}`);
    } catch (err) {
      log(`timeout failed on counter ${counter.id}: ${(err as Error).message}`);
    }
  }
}

/**
 * Each side's agent acting for its principal, inside the bounds they set.
 *
 * A worker's agent counters when an offer falls under their stated minimum - a
 * counter proposes, it commits nobody. A requester's agent settles a counter
 * that is within the budget they already published. Anything outside those
 * bounds stays with the human, and both are told what their agent did.
 */
async function autoNegotiate(): Promise<void> {
  const { offers, counters } = await market.pendingNegotiation();
  const now = Date.now();

  for (const offer of offers) {
    if (now - new Date(offer.outreach_sent_at).getTime() < config.negotiationGraceMs) continue;

    const min = offer.min_price_usd != null ? Number(offer.min_price_usd) : null;
    const pays = Number(offer.offered_usd ?? offer.budget_usd ?? 0);
    const hasPrice = Number(offer.offered_usd ?? 0) > 0 || Number(offer.budget_usd ?? 0) > 0;

    if (offer.auto_accept && min != null && pays >= min) {
      try {
        await market.respond(offer.id, true, offer.phone);
        if (offer.order_id) {
          await postLiveEvent({
            orderId: offer.order_id,
            kind: "accepted",
            message: "Taken automatically at their minimum.",
            offerId: String(offer.id),
            state: "accepted",
          });
        }
        await sayTo(
          offer.phone,
          `"${offer.title}" came in at $${pays}, at or above your $${min} minimum, so I took it for you.`,
          `gotchu-autoaccept-${offer.id}`,
        );
        log(`auto-accepted offer ${offer.id} at $${pays}`);
      } catch (err) {
        log(`auto-accept failed on offer ${offer.id}: ${(err as Error).message}`);
      }
      continue;
    }

    if (offer.auto_counter === false || min == null) continue;
    if (!hasPrice) continue; // open budget: leave it to the human
    if (pays >= min) continue; // fine as offered; their call to take it

    try {
      const verdict = await evaluateDeal({
        order: {
          title: offer.title,
          details: offer.details,
          category: offer.category,
          budget_usd: offer.budget_usd,
          deadline_at: offer.deadline_at,
          pickup_location: offer.pickup_location,
          dropoff_location: offer.dropoff_location,
        },
        current_offer_usd: pays,
        decision: "AUTO_WORKER",
        worker_min_usd: min,
        round: Number(offer.counter_rounds ?? 0),
      });
      if (verdict?.action === "TRY_NEXT") {
        await market.respond(offer.id, false);
        if (offer.order_id) {
          await postLiveEvent({
            orderId: offer.order_id,
            kind: "timeout",
            message: "Trying the next person.",
            offerId: String(offer.id),
            state: "dropped",
          });
        }
        log(`broker said try next on offer ${offer.id}`);
        continue;
      }
      if (!verdict || verdict.action !== "COUNTER" || verdict.nextOfferUsd == null) {
        continue;
      }
      const result = await market.counter(
        offer.id,
        offer.phone,
        verdict.nextOfferUsd,
        verdict.messageHint,
      );
      if (result.status !== "countered") {
        if (result.status === "cancelled_too_many_rounds" && offer.order_id) {
          await postLiveEvent({
            orderId: offer.order_id,
            kind: "skipped",
            message: "Negotiation ended. Trying the next person.",
            offerId: String(offer.id),
            state: "dropped",
          });
        }
        log(`auto-counter stopped on offer ${offer.id}: ${result.status}`);
        continue;
      }
      if (offer.order_id) {
        await postLiveEvent({
          orderId: offer.order_id,
          kind: "countered",
          message: "Counter offer sent.",
          offerId: String(offer.id),
          state: "countered",
        });
      }
      const paid = pays > 0 ? `$${pays}` : "no set price";
      await sayTo(
        offer.phone,
        `"${offer.title}" came in at ${paid}, under your $${min} minimum, so I countered at $${verdict.nextOfferUsd} for you. I'll tell you what they say.`,
        `gotchu-autocounter-${offer.id}`,
      );
      log(`auto-countered offer ${offer.id} for ${offer.phone} at $${verdict.nextOfferUsd}`);
    } catch (err) {
      log(`auto-counter failed on offer ${offer.id}: ${(err as Error).message}`);
    }
  }

  for (const counter of counters) {
    if (!counter.order_budget_usd) continue; // no published budget; human decides
    if (now - new Date(counter.countered_at).getTime() < config.negotiationGraceMs) continue;

    const asking = Number(counter.counter_price_usd);
    const budget = Number(counter.order_budget_usd);

    try {
      const verdict = await evaluateDeal({
        order: {
          title: counter.title,
          budget_usd: counter.order_budget_usd,
        },
        current_offer_usd: Number(counter.offered_usd ?? counter.order_budget_usd ?? asking),
        decision: "AUTO_REQUESTER",
        price_usd: asking,
        round: Number(counter.counter_rounds ?? 0),
      });
      if (verdict?.action === "TRY_NEXT") {
        await market.respondToCounter(counter.id, counter.requester_phone, false, true);
        if (counter.order_id) {
          await postLiveEvent({
            orderId: counter.order_id,
            kind: "timeout",
            message: "Trying the next person.",
            offerId: String(counter.id),
            state: "dropped",
          });
        }
        log(`broker said try next on counter ${counter.id}`);
        continue;
      }
      if (!verdict || verdict.action !== "ACCEPT") {
        continue;
      }
      await market.respondToCounter(counter.id, counter.requester_phone, true);
      if (counter.order_id) {
        await postLiveEvent({
          orderId: counter.order_id,
          kind: "accepted",
          message: "Someone took the job.",
          offerId: String(counter.id),
          state: "accepted",
        });
      }
      await sayTo(
        counter.requester_phone,
        `Someone asked $${asking} for "${counter.title}", inside the $${budget} you set, so I agreed for you. They're on it.`,
        `gotchu-autoaccept-${counter.id}`,
      );
      log(`auto-accepted counter ${counter.id} at $${asking} for ${counter.requester_phone}`);
    } catch (err) {
      log(`auto-accept failed on counter ${counter.id}: ${(err as Error).message}`);
    }
  }
}

const NUDGE_AFTER_MINUTES = 10;
const NUDGE_REPEAT_MINUTES = 10;
const FINAL_NOTICE_STRIKE = 3;

/**
 * Chase anything that has sat unanswered, with a card loud enough to notice.
 * The ladder climbs: two notices, a final one, and then the stated consequence
 * actually happens - the offer is released and goes back to the pool. A warning
 * the system will not carry out is just a lie with a red X on it.
 */
async function chaseStuckItems(): Promise<void> {
  const stuck = await market.escalations(NUDGE_AFTER_MINUTES);

  for (const item of stuck) {
    const key = `${item.reason}:${item.phone}:${item.offer_id ?? item.question_id ?? item.about}`;
    const since = await minutesSinceNudge(key);
    if (since !== null && since < NUDGE_REPEAT_MINUTES) continue;

    const strike = await bumpNudge(key, item.phone);

    // Past the final notice, do the thing the card said would happen.
    if (strike > FINAL_NOTICE_STRIKE) {
      if (item.reason === "offer_unanswered" && item.offer_id) {
        const released = await market.respond(item.offer_id, false).catch(() => null);
        if (!released) {
          log(`offer ${item.offer_id} changed before escalation could release it`);
          continue;
        }
        if (item.order_id) {
          await postLiveEvent({
            orderId: item.order_id,
            kind: "timeout",
            message: "No reply in time. Trying the next person.",
            offerId: item.offer_id,
            state: "dropped",
          });
        }
        log(`released offer ${item.offer_id} after ${strike - 1} notices`);
      } else if (item.reason === "counter_undecided" && item.offer_id) {
        const released = await market
          .respondToCounter(item.offer_id, item.phone, false, true)
          .catch(() => null);
        if (!released) {
          log(`counter ${item.offer_id} changed before escalation could release it`);
          continue;
        }
        await sayTo(
          item.phone,
          `No answer on that counter-offer for "${item.about}", so it's expired. I'm asking someone else.`,
          `gotchu-counterexpired-${item.offer_id}`,
          "counter_expired",
          item.offer_id,
        );
        if (item.order_id) {
          await postLiveEvent({
            orderId: item.order_id,
            kind: "timeout",
            message: "No decision in time. Trying the next person.",
            offerId: item.offer_id,
            state: "dropped",
          });
        }
        log(`expired counter ${item.offer_id} after ${strike - 1} notices`);
      } else if (item.reason === "question_unanswered" && item.question_id) {
        await market
          .answerQuestion(
            item.question_id,
            item.phone,
            "No answer in time. The worker can go ahead without this.",
          )
          .catch(() => null);
        await sayTo(
          item.phone,
          `No answer on that question about "${item.about}", so I've closed it. The job is still moving.`,
          `gotchu-questionexpired-${item.question_id}`,
          "question_expired",
          item.question_id,
        );
        log(`expired question ${item.question_id} after ${strike - 1} notices`);
      }
      continue;
    }

    const html = buildNudgeHtml({
      name: item.name,
      reason: item.reason,
      about: item.about,
      callingAbout: item.calling_about,
      minutesWaiting: item.minutes_waiting,
      strike,
      finalNotice: strike >= FINAL_NOTICE_STRIKE,
    });

    const attachmentId = await uploadAttachment(html, "text/html");
    const headline = strike >= FINAL_NOTICE_STRIKE ? "Final notice" : "Still waiting on you";
    const text = `${headline}: ${item.calling_about}. Reply and I'll take it from there.`;

    const sent = await sendText(
      item.phone,
      shorten(text),
      `gotchu-nudge-${key.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 90)}-${strike}`,
      attachmentId ? [attachmentId] : undefined,
    );
    await recordSent(sent.requestId, item.phone, "nudge", item.offer_id ?? item.question_id ?? null, text);

    if (sent.accepted) {
      const history = await loadTurns(item.phone);
      await saveTurns(item.phone, [
        ...history,
        { role: "assistant", content: text, at: new Date().toISOString() },
      ]);
    }
    log(
      `nudge ${strike}${strike >= FINAL_NOTICE_STRIKE ? " (final)" : ""} -> ${item.phone} ` +
        `[${item.reason}, ${item.minutes_waiting}m] ${attachmentId ? "with card" : "text only"}: ${sent.detail}`,
    );
  }
}

/**
 * Draw each new task and send it to whoever asked for it. Generation takes
 * about 20 seconds, which is why this runs on its own loop instead of blocking
 * a reply: the text lands immediately, the picture follows.
 */
async function illustrateOrders(): Promise<void> {
  const pending = await market.ordersNeedingImage();

  for (const order of pending.slice(0, 2)) {
    const made = await generateTaskImage(order);
    if (!made) {
      log(`could not illustrate "${order.title}"`);
      continue;
    }
    const imgKey = await putImage(order.id, made.png);
    await market.storeOrderImage(
      order.id,
      imgKey ? { storage_key: imgKey, bytes: made.png.length } : { png_base64: made.png.toString("base64") },
      made.prompt,
    );
    await postLiveMedia({
      orderId: order.id,
      kind: "image",
      storageKey: imgKey ?? undefined,
      pngBase64: imgKey ? undefined : made.png.toString("base64"),
      prompt: made.prompt,
    });
    log(`illustrated "${order.title}" (${made.png.length} bytes)`);

    // Show the requester what the agent understood, in a picture.
    const attachmentId = await uploadAttachment(made.png, "image/png");
    if (!attachmentId) continue;
    const caption = `Here's how I pictured it: ${order.title}. Tell me if that's not the job.`;
    const sent = await sendText(
      order.requester_phone,
      shorten(caption),
      `gotchu-illustration-${order.id}`,
      [attachmentId],
    );
    await recordSent(sent.requestId, order.requester_phone, "illustration", order.id, caption);
    if (sent.accepted) {
      const history = await loadTurns(order.requester_phone);
      await saveTurns(order.requester_phone, [
        ...history,
        { role: "assistant", content: caption, at: new Date().toISOString() },
      ]);
    }
    log(`illustration -> ${order.requester_phone}: ${sent.detail}`);
  }
}

/**
 * Orders being filmed right now. Generation takes minutes, and both the film
 * loop and an offer waiting to go out can ask for the same clip, so the set
 * stops a task being filmed twice.
 */
const filming = new Set<string>();

/**
 * Film one task and put the clip in the bucket. Delivery is not done here:
 * the film goes out attached to the offer itself, so there is exactly one
 * path a clip reaches a person by.
 */
async function filmOrder(order: FilmableOrder & { id: string; title: string }): Promise<boolean> {
  if (filming.has(order.id)) return false;
  filming.add(order.id);
  try {
    log(`filming "${order.title}"...`);
    const made = await generateTaskVideo(order);
    if (!made) {
      log(`could not film "${order.title}"`);
      return false;
    }

    const key = await putVideo(order.id, made.mp4);
    await market.storeOrderVideo(
      order.id,
      key ? { storage_key: key, bytes: made.mp4.length } : { mp4_base64: made.mp4.toString("base64") },
      made.prompt,
      made.seconds,
    );
    await postLiveMedia({
      orderId: order.id,
      kind: "video",
      storageKey: key ?? undefined,
      mp4Base64: key ? undefined : made.mp4.toString("base64"),
      prompt: made.prompt,
    });
    log(`filmed "${order.title}" (${made.mp4.length} bytes, ${made.seconds}s${key ? `, ${key}` : ", inline"})`);
    return true;
  } finally {
    filming.delete(order.id);
  }
}

/** Keep clips ready for tasks that do not have one yet. */
async function filmOpenTasks(): Promise<void> {
  const pending = await market.ordersNeedingVideo();
  const order = pending.find((o: { id: string }) => !filming.has(o.id));
  if (!order) return;
  await filmOrder(order);
}

/** The illustration for a task, from the bucket or from an older inline row. */
async function imageFor(orderId: string): Promise<Buffer | null> {
  const stored = await market.orderImage(orderId).catch(() => null);
  if (!stored) return null;
  if (stored.storage_key) return getImage(stored.storage_key);
  if (stored.png_base64) return Buffer.from(stored.png_base64, "base64");
  return null;
}

/**
 * Send a finished film to the person who paid for it and to everyone
 * currently taking work. A film is now something a requester asks for and is
 * charged for, so it goes to the whole active pool rather than to whoever
 * happened to hold an offer.
 *
 * One film per pass: a backlog should trickle, not arrive all at once.
 */
async function deliverFilmsToRequesters(): Promise<void> {
  const pending = await market.videosPendingDelivery();
  const film = pending[0];
  if (!film?.requester_phone || !film.order_id) return;

  const mp4 = await videoFor(String(film.order_id));
  if (!mp4) return;
  const attachmentId = await uploadAttachment(mp4, "video/mp4");
  if (!attachmentId) {
    log(`could not upload the trailer for "${film.title}"`);
    return;
  }

  const requester = String(film.requester_phone);
  const caption = `We made a trailer for your request: "${film.title}". Sixteen seconds, and it takes itself extremely seriously.`;
  const sent = await sendText(
    requester, shorten(caption),
    `gotchu-trailer-${film.order_id}`, [attachmentId],
  );
  await recordSent(sent.requestId, requester, "trailer", String(film.order_id), caption);

  // The point of paying for one is that everyone taking work sees the job.
  const pitch = `Someone wants this done: "${film.title}". Sixteen seconds on why it matters. Text me if you'll take it.`;
  let active: Array<{ phone?: string }> = [];
  try {
    active = await market.activeWorkers();
  } catch (err) {
    log(`could not load the film audience for "${film.title}": ${(err as Error).message}`);
    return;
  }
  let allDelivered = sent.accepted || sent.permanent;
  for (const worker of active) {
    if (!worker.phone || worker.phone === requester) continue;
    const out = await sendText(
      worker.phone, shorten(pitch),
      `gotchu-trailer-${film.order_id}-${worker.phone.replace(/\D/g, "")}`, [attachmentId],
    );
    await recordSent(out.requestId, worker.phone, "trailer", String(film.order_id), pitch);
    if (out.accepted) {
      const history = await loadTurns(worker.phone);
      await saveTurns(worker.phone, [
        ...history,
        { role: "assistant", content: pitch, at: new Date().toISOString() },
      ]);
    }
    if (!out.accepted && !out.permanent) allDelivered = false;
    log(`trailer broadcast -> ${worker.phone}: ${out.detail}`);
  }

  // Stable idempotency keys make retries safe. Do not close the queue row
  // until every intended recipient either accepted or failed permanently.
  if (allDelivered) {
    await market.markVideoDelivered(String(film.order_id)).catch(() => null);
  }
  if (sent.accepted) {
    const history = await loadTurns(String(film.requester_phone));
    await saveTurns(String(film.requester_phone), [
      ...history,
      { role: "assistant", content: caption, at: new Date().toISOString() },
    ]);
  }
  log(`trailer "${film.title}" -> ${film.requester_phone}: ${sent.detail}`);
}

/** The clip for an offer, from the bucket or from an older inline row. */
async function videoFor(orderId: string): Promise<Buffer | null> {
  const stored = await market.orderVideo(orderId).catch(() => null);
  if (!stored) return null;
  if (stored.storage_key) return getVideo(stored.storage_key);
  if (stored.mp4_base64) return Buffer.from(stored.mp4_base64, "base64");
  return null;
}

async function loop(name: string, fn: () => Promise<void>, seconds: number) {
  for (;;) {
    try {
      await fn();
    } catch (err) {
      log(`${name} loop error: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, seconds * 1000));
  }
}

async function main() {
  await ensureAgentSchema();

  // Clips go to object storage; without it they fall back to living in the
  // database, so say which one is in play rather than failing quietly.
  if (storageConfigured()) {
    const ready = await ensureBucket();
    log(ready ? "object storage ready" : "object storage unreachable - clips will be stored inline");
  } else {
    log("no object storage configured - clips will be stored inline");
  }

  // First boot: skip the backlog sitting in the relay rather than answering
  // months of old messages.
  if ((await getCursor()) === 0) {
    let end = 0;
    for (;;) {
      const { events, nextCursor } = await pollEvents(end);
      if (!events.length || nextCursor === end) break;
      end = nextCursor;
    }
    await setCursor(end);
    log(`first boot: starting from cursor ${end}`);
  }

  const handleHttp = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/health") {
      try {
        await pool.query("SELECT 1");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, watching: config.allowedNumbers.length || "all enrolled" }));
      } catch {
        res.writeHead(503).end('{"ok":false}');
      }
      return;
    }

    // Read one person's thread, for checking how an exchange actually went.
    if (req.method === "GET" && req.url?.startsWith("/v1/conversation")) {
      const phone = new URL(req.url, "http://local").searchParams.get("phone") ?? "";
      if (config.allowedNumbers.length && !config.allowedNumbers.includes(phone)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "not in allowlist" }));
        return;
      }
      const turns = await loadTurns(phone);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: { phone, turns } }));
      return;
    }

    // Operator channel: say something as the agent. It goes into the person's
    // conversation, so their reply is understood in context instead of
    // arriving as a bare "yes" about nothing.
    if (req.method === "POST" && req.url === "/v1/say") {
      try {
        const raw = await new Promise<string>((resolve, reject) => {
          let data = "";
          req.on("data", (c) => (data += c));
          req.on("end", () => resolve(data));
          req.on("error", reject);
        });
        const body = JSON.parse(raw || "{}");
        const text = String(body.text ?? "").trim();
        const phones: string[] = Array.isArray(body.phones) ? body.phones : [];

        // Optionally attach a task's illustration, so a follow-up lands in the
        // same thread with the picture rather than as a bare resend.
        let attachmentIds: string[] | undefined;
        if (body.order_id) {
          const png = await imageFor(String(body.order_id));
          if (png) {
            const id = await uploadAttachment(png, "image/png");
            if (id) attachmentIds = [id];
          }
        }
        if (!text || !phones.length) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "phones and text are required" }));
          return;
        }

        const results = [];
        for (const phone of phones) {
          // Only people already on the allowlist; this endpoint is not a way
          // to text strangers.
          if (config.allowedNumbers.length && !config.allowedNumbers.includes(phone)) {
            results.push({ phone, sent: false, detail: "not in allowlist" });
            continue;
          }
          const message = shorten(text);
          const key = `gotchu-say-${Date.now()}-${phone.replace(/\D/g, "")}`;
          const sent = await sendText(phone, message, key, attachmentIds);
          if (sent.accepted) {
            const history = await loadTurns(phone);
            await saveTurns(phone, [
              ...history,
              { role: "assistant", content: message, at: new Date().toISOString() },
            ]);
          }
          log(`say -> ${phone}: ${sent.accepted ? "sent" : "FAILED " + sent.detail}`);
          results.push({ phone, sent: sent.accepted, detail: sent.detail });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: results }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
      }
      return;
    }

    res.writeHead(404).end();
  };

  createServer((req, res) => {
    // Node ignores the promise an async listener returns, so one unguarded
    // await in any route rejects unhandled and takes the process down - and
    // with it every loop that does the texting. Catch it here once, so no
    // future route has to remember.
    handleHttp(req, res).catch((err) => {
      log(`http error on ${req.url}: ${(err as Error).message}`);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      if (!res.writableEnded) res.end('{"ok":false,"error":"internal"}');
    });
  }).listen(config.port, () => log(`http on :${config.port}`));

  log(`gotchu agent up - model ${config.model}, market-maker ${config.marketMakerUrl}, numbers: ${config.allowedNumbers.join(", ") || "all enrolled"}`);
  loop("inbound", pollInbound, config.pollSeconds);
  loop("handoffs", deliverHandoffs, 5);
  loop("match", matchOpenOrders, 10);
  loop("outreach", sendOutreach, 5);
  loop("negotiate", autoNegotiate, 8);
  loop("expire", expireStaleOffers, 30);
  loop("live-skip", applyLiveSkips, 5);
  loop("chase", chaseStuckItems, 60);
  loop("illustrate", illustrateOrders, 30);
  loop("film", filmOpenTasks, 120);
  loop("trailer", deliverFilmsToRequesters, 60);
}

// Last line of defence. A background loop or a stray await must not be able
// to end the process silently: log it and keep the other loops running, so a
// single bad poll does not stop every text the system sends.
process.on("unhandledRejection", (reason) => {
  console.error(`unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
});
process.on("uncaughtException", (err) => {
  console.error(`uncaught exception: ${err.stack ?? err.message}`);
});

main().catch((err) => {
  console.error("fatal", err);
  process.exit(1);
});
