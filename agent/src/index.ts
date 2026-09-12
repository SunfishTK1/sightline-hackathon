import { createServer } from "node:http";
import { config } from "./config.js";
import {
  ensureAgentSchema, getCursor, setCursor, claimEvent, completeEvent, loadTurns,
  saveTurns, pool, getAttempt, recordAttempt, bumpOutreachAttempt,
  recordSent, findSent, type Turn,
} from "./db.js";
import {
  pollEvents, sendText, shorten, fetchAttachment, getDelivery, type RelayEvent,
} from "./imessage.js";
import { prepareImage } from "./images.js";
import { undeliveredHandoffs, markHandoffDelivered, mcp, market, type Handoff } from "./mcp.js";
import { pickWorkers } from "./matcher.js";
import { respond } from "./agent.js";

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

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
  const repliedTo = event.data.inReplyTo?.providerMessageId;
  if (repliedTo) {
    const prior = await findSent(repliedTo).catch(() => null);
    if (prior) {
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
    );
    reply = shorten(result.reply);
    usedTools = result.usedTools;
    toolTurns = result.toolTurns;
  } catch (err) {
    log(`agent error for ${phone}: ${(err as Error).message}`);
    reply = "I hit a snag on my end - say that again and I'll pick it back up.";
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
    await saveTurns(phone, [
      ...history,
      { role: "user", content: text, at: receivedAt },
      ...toolTurns,
      { role: "assistant", content: reply, at: new Date().toISOString() },
    ]);
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
    if (data.kind === "loved" || data.kind === "liked") {
      const result = await market.respondToCounter(prior.ref_id, phone, true).catch(() => null);
      reply = result
        ? "Agreed to that price for you - it's theirs now."
        : "That counter isn't open any more, so I couldn't agree to it.";
    } else if (data.kind === "disliked") {
      const result = await market.respondToCounter(prior.ref_id, phone, false).catch(() => null);
      reply = result
        ? "Turned down that price. The job stays open at what you offered."
        : "That counter isn't open any more.";
    }
  }

  if (!reply && prior?.kind === "offer" && prior.ref_id) {
    const jobs = await market.openJobs(phone).catch(() => []);
    const open = jobs.find((j) => String(j.id) === String(prior.ref_id));

    if (data.kind === "loved" || data.kind === "liked") {
      if (!open) {
        reply = "That job isn't open any more, so I couldn't take it for you.";
      } else {
        await market.respond(open.id, true).catch(() => null);
        reply = `Taking that as a yes on "${open.title}" - it's yours. Text me if you didn't mean that.`;
      }
    } else if (data.kind === "disliked") {
      if (open) {
        await market.respond(open.id, false).catch(() => null);
        reply = `Passed on "${open.title}" for you.`;
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

function handoffText(handoff: Handoff): string | null {
  if (handoff.kind === "call_summary") {
    const resolution = handoff.resolution || handoff.payload?.resolution || "";
    return `From your call: ${handoff.payload?.summary || handoff.summary || ""} ${resolution}`.trim();
  }
  if (handoff.kind === "order_confirmation") {
    const price = handoff.payload?.budget_usd;
    const priceText = price && Number(price) > 0 ? ` at $${price}` : "";
    return `Your request is in: ${handoff.payload?.title}${priceText}. I'll text you when someone picks it up.`;
  }
  if (handoff.kind === "worker_accepted") {
    return `Someone just took your request: ${handoff.payload?.title}. I'll let you know when it's done.`;
  }
  if (handoff.kind === "counter_received") {
    const was = handoff.payload?.original_usd ? ` instead of $${handoff.payload.original_usd}` : "";
    const note = handoff.payload?.note ? ` They said: "${handoff.payload.note}"` : "";
    return `Someone will do "${handoff.payload?.title}" for $${handoff.payload?.asking_usd}${was}.${note} Reply YES to agree or NO to pass.`;
  }
  if (handoff.kind === "counter_accepted") {
    return `Your price was accepted: "${handoff.payload?.title}" at $${handoff.payload?.agreed_usd}. It's yours.`;
  }
  if (handoff.kind === "question_asked") {
    return `About "${handoff.payload?.title}" - someone considering it asks: ${handoff.payload?.question} Reply with the answer and I'll pass it straight back.`;
  }
  if (handoff.kind === "question_answered") {
    return `On "${handoff.payload?.title}" you asked: ${handoff.payload?.question} They said: ${handoff.payload?.answer}`;
  }
  if (handoff.kind === "counter_declined") {
    const still = handoff.payload?.still_offered_usd
      ? ` It's still open at $${handoff.payload.still_offered_usd} if you want it.`
      : " It's still open at the original price if you want it.";
    return `They passed on $${handoff.payload?.asked_usd} for "${handoff.payload?.title}".${still}`;
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
    const candidates = await market.candidates(order.id);
    if (!candidates.length) continue;

    const picks = await pickWorkers(order, candidates);
    if (!picks.length) {
      log(`no suitable worker for "${order.title}" among ${candidates.length} available`);
      continue;
    }
    for (const pick of picks) {
      const offer = await market.createOffer(order.id, pick.phone, pick.reason);
      if (offer) log(`offered "${order.title}" to ${pick.phone}: ${pick.reason}`);
    }
  }
}

/** Text each pending offer to the person it was made to. */
async function sendOutreach(): Promise<void> {
  for (const offer of await market.pendingOutreach()) {
    const pay = offer.budget_usd && Number(offer.budget_usd) > 0
      ? `$${offer.budget_usd}`
      : "price open";
    const due = offer.deadline_at
      ? ` by ${new Date(offer.deadline_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
      : "";
    const call = config.voiceCallNumber
      ? `, or call ${config.voiceCallNumber} to talk it through`
      : "";
    const text = `Job for you: ${offer.title} (${pay})${due}. Reply YES to take it or NO to pass${call}.`;

    const attempt = await bumpOutreachAttempt(offer.id);
    // The relay requires an 8-128 char key; a bare "offer-1" is too short and
    // is rejected outright.
    const key = `gotchu-offer-${offer.id}-attempt-${attempt}`;
    const message = shorten(text);
    const sent = await sendText(offer.phone, message, key);
    await recordSent(sent.requestId, offer.phone, "offer", String(offer.id), message);

    if (sent.accepted || sent.permanent) {
      await market.markOutreachSent(offer.id);
      if (sent.accepted) {
        // The offer has to land in their thread, or a later "I'll take the
        // fridge one" refers to a message the agent has no record of sending.
        const history = await loadTurns(offer.phone);
        await saveTurns(offer.phone, [
          ...history,
          { role: "assistant", content: message, at: new Date().toISOString() },
        ]);
      }
      log(`outreach offer ${offer.id} -> ${offer.phone}: ${sent.detail}`);
      continue;
    }
    if (attempt >= MAX_OUTREACH_ATTEMPTS) {
      // Stop asking. Otherwise an unreachable number is re-texted forever.
      await market.markOutreachSent(offer.id);
      log(`outreach offer ${offer.id} GIVING UP after ${attempt} attempts to ${offer.phone}: ${sent.detail}`);
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
    const text = handoffText(handoff);
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
    const sent = await sendText(handoff.phone, shorten(text), `handoff-${handoff.id}-a${attemptNo}`);
    // A counter notification has to remember the offer, not the order: that is
    // what answering it needs.
    const refId = handoff.kind === "counter_received"
      ? String(handoff.payload?.offer_id ?? "")
      : String(handoff.order_id ?? "");
    await recordSent(sent.requestId, handoff.phone, handoff.kind, refId, shorten(text));

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
): Promise<boolean> {
  const message = shorten(text);
  const sent = await sendText(phone, message, key);
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
    if (offer.auto_counter === false || !offer.min_price_usd) continue;
    if (now - new Date(offer.outreach_sent_at).getTime() < config.negotiationGraceMs) continue;

    const min = Number(offer.min_price_usd);
    const pays = offer.budget_usd ? Number(offer.budget_usd) : 0;
    if (pays >= min) continue; // fine as offered; their call to take it

    try {
      await market.counter(offer.id, offer.phone, min, `${min} is my minimum for this kind of job`);
      const paid = pays > 0 ? `$${pays}` : "no set price";
      await sayTo(
        offer.phone,
        `"${offer.title}" came in at ${paid}, under your $${min} minimum, so I countered at $${min} for you. I'll tell you what they say.`,
        `gotchu-autocounter-${offer.id}`,
      );
      log(`auto-countered offer ${offer.id} for ${offer.phone} at $${min}`);
    } catch (err) {
      log(`auto-counter failed on offer ${offer.id}: ${(err as Error).message}`);
    }
  }

  for (const counter of counters) {
    if (!counter.order_budget_usd) continue; // no published budget; human decides
    if (now - new Date(counter.countered_at).getTime() < config.negotiationGraceMs) continue;

    const asking = Number(counter.counter_price_usd);
    const budget = Number(counter.order_budget_usd);
    if (asking > budget) continue; // over what they said they'd pay; human decides

    try {
      await market.respondToCounter(counter.id, counter.requester_phone, true);
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

  createServer(async (req, res) => {
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
          const sent = await sendText(phone, message, key);
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
  }).listen(config.port, () => log(`http on :${config.port}`));

  log(`gotchu agent up - model ${config.model}, numbers: ${config.allowedNumbers.join(", ") || "all enrolled"}`);
  loop("inbound", pollInbound, config.pollSeconds);
  loop("handoffs", deliverHandoffs, 5);
  loop("match", matchOpenOrders, 10);
  loop("outreach", sendOutreach, 5);
  loop("negotiate", autoNegotiate, 8);
}

main().catch((err) => {
  console.error("fatal", err);
  process.exit(1);
});
