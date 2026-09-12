import { config } from "./config.js";
import {
  mcp, market, type OpenJob, type MyOrder, type OpenCounter, type JobQuestion,
  type WorkItem,
} from "./mcp.js";
import { CAMPUS_CONTEXT } from "./campus.js";
import { evaluateDeal } from "./broker.js";
import type { Turn } from "./db.js";

const OPENAI_URL = "https://api.openai.com/v1/responses";

/**
 * Tool schemas the model sees. Note what is absent: the caller's phone number.
 * It is bound from the inbound message server-side, so one person's agent
 * cannot read or write another person's record even if the model asks.
 */
const TOOL_SCHEMAS = [
  {
    type: "function",
    name: "submit_request",
    description:
      "Submit the task the person wants done. Only call this once you know what they need and either a budget or that they did not give one.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short summary, e.g. 'Package pickup: UC to Gates'" },
        details: { type: "string", description: "What they need, in their own words" },
        category: { type: "string", description: "pickup, food, errand, moving, tutoring, other" },
        pickup_location: { type: "string" },
        dropoff_location: { type: "string" },
        deadline_at: { type: "string", description: "ISO 8601 timestamp, or empty if none" },
        budget_usd: { type: "number", description: "0 if they did not name a price" },
        urgency: { type: "string", enum: ["now", "today", "this_week", "whenever"] },
      },
      required: [
        "title", "details", "category", "pickup_location", "dropoff_location",
        "deadline_at", "budget_usd", "urgency",
      ],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "set_availability",
    description:
      "Record that this person will pick up jobs for other people, or that they want to stop. Use it when they say they want to earn, are free, or want out of the pool.",
    parameters: {
      type: "object",
      properties: {
        is_available: { type: "boolean", description: "false takes them out of the pool" },
        blurb: {
          type: "string",
          description: "Their own words: where they are, what they'll do, when they're free",
        },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "pickup, food, errand, moving, tutoring, design, other",
        },
        min_price_usd: { type: "number", description: "Lowest they'll work for; 0 if unsaid" },
      },
      required: ["is_available", "blurb", "categories", "min_price_usd"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "respond_to_job",
    description:
      "Accept or turn down one job they were offered. They may be holding several at once, so pass the offer id of the one they mean. If it is unclear which, ask them first. If they can do it but need more time, do not accept — use counter_offer at the same price with a note about the time.",
    parameters: {
      type: "object",
      properties: {
        offer_id: { type: "string", description: "The offer id from the list of open offers" },
        accept: { type: "boolean" },
      },
      required: ["offer_id", "accept"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "mark_task_done",
    description:
      "They finished a job they were doing. The requester is then asked to confirm, and payment is only recorded once they do.",
    parameters: {
      type: "object",
      properties: { order_id: { type: "string", description: "The job they finished" } },
      required: ["order_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "confirm_task_done",
    description:
      "They confirm a task they requested was actually done, which releases payment. Use confirmed false if they say it was not done properly.",
    parameters: {
      type: "object",
      properties: {
        order_id: { type: "string" },
        confirmed: { type: "boolean" },
        note: { type: "string", description: "What was wrong, if not confirmed; empty otherwise" },
      },
      required: ["order_id", "confirmed", "note"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "ask_about_job",
    description:
      "Ask the person who requested a job a question about it, on this person's behalf. Use it immediately when something about an offered job is unclear - which building, which desk, what exactly is wanted - rather than guessing or telling them to wait.",
    parameters: {
      type: "object",
      properties: {
        offer_id: { type: "string", description: "The offer id of the job in question" },
        question: { type: "string", description: "The question in plain words" },
      },
      required: ["offer_id", "question"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "answer_job_question",
    description:
      "Answer a question somebody asked about a task this person requested. The person who asked is told straight away.",
    parameters: {
      type: "object",
      properties: {
        question_id: { type: "string" },
        answer: { type: "string" },
      },
      required: ["question_id", "answer"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "counter_offer",
    description:
      "Propose different terms for a job they were offered — a different price, more time, or both. Use it when they name a price they would do it for, or when they say they cannot make the deadline. The person who asked for the task then decides.",
    parameters: {
      type: "object",
      properties: {
        offer_id: { type: "string", description: "The offer id from their open offers" },
        price_usd: { type: "number", description: "What they want to be paid" },
        note: { type: "string", description: "Why, in their words; empty if they gave no reason" },
      },
      required: ["offer_id", "price_usd", "note"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "respond_to_counter",
    description:
      "Accept or turn down a counter-offer somebody made on a task this person asked for. Accepting sets the new price and gives them the job.",
    parameters: {
      type: "object",
      properties: {
        offer_id: { type: "string", description: "The offer id from the counters awaiting them" },
        accept: { type: "boolean" },
      },
      required: ["offer_id", "accept"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "update_request",
    description:
      "Change the price, deadline or details on a request this person made themselves. Use it when they want to raise the pay or move the deadline on their own task.",
    parameters: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "The request id from their own open requests" },
        budget_usd: { type: "number", description: "New price, or 0 to leave unchanged" },
        deadline_at: { type: "string", description: "ISO 8601 timestamp, or empty to leave unchanged" },
        details: { type: "string", description: "Replacement details, or empty to leave unchanged" },
      },
      required: ["request_id", "budget_usd", "deadline_at", "details"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_my_activity",
    description:
      "Look up this person's own recent requests and whether they have a call in progress. Use it when they ask about something they already asked for.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
];

function describeOpenJobs(openJobs: OpenJob[]): string {
  if (!openJobs.length) {
    return "They have no job offers open right now. If they ask for work, use set_availability so the marketplace can start sending them jobs.";
  }
  const list = openJobs
    .map((j) => `[offer ${j.id}] ${j.title}${j.budget_usd ? ` for $${j.budget_usd}` : " (no price set)"}`)
    .join("; ");
  return (
    `They are currently holding ${openJobs.length} open job offer(s): ${list}. ` +
    "If they take one or pass on it, call respond_to_job with that offer's id. " +
    "If it is not obvious which one they mean, ask before responding - never guess."
  );
}

function describeMyRequests(myOrders: MyOrder[]): string {
  const live = myOrders.filter((o) =>
    ["submitted", "offered", "accepted"].includes(o.status),
  );
  if (!live.length) {
    return "They have no open requests of their own right now. If they refer to a task they think they posted, tell them plainly that you have no record of it rather than playing along.";
  }
  const list = live
    .map((o) => `[request ${o.id}] ${o.title}${o.budget_usd ? ` at $${o.budget_usd}` : " (no price set)"} - ${o.status}`)
    .join("; ");
  return (
    `Their own open requests: ${list}. That is the complete list. ` +
    "If they mention a request that is not on it, say you have no record of it instead of inventing one. " +
    "To change the price, deadline or details of one of these, use update_request."
  );
}

function describeCounters(counters: OpenCounter[]): string {
  if (!counters.length) return "Nobody is waiting on a decision from them about a counter-offer.";
  const list = counters
    .map((c) => {
      const was = c.budget_usd ? ` (they offered $${c.budget_usd})` : "";
      const note = c.counter_note ? ` - "${c.counter_note}"` : "";
      return `[offer ${c.id}] someone will do "${c.title}" for $${c.counter_price_usd}${was}${note}`;
    })
    .join("; ");
  return (
    `Counter-offers waiting on their decision: ${list}. ` +
    "Use respond_to_counter with that offer id when they say yes or no. " +
    "Accepting sets the new price and gives that person the job."
  );
}

function describeQuestions(q?: { waiting_on_them: JobQuestion[]; they_asked: JobQuestion[] }): string {
  const parts: string[] = [];
  if (q?.waiting_on_them?.length) {
    parts.push(
      "Questions waiting on them about tasks they requested: " +
        q.waiting_on_them
          .map((x) => `[question ${x.id}] on "${x.title}": "${x.question}"`)
          .join("; ") +
        ". Answer with answer_job_question and the asker is told immediately.",
    );
  }
  const answered = (q?.they_asked ?? []).filter((x) => x.answer);
  if (answered.length) {
    parts.push(
      "Answers to questions they asked: " +
        answered.map((x) => `on "${x.title}", "${x.question}" - ${x.answer}`).join("; ") + ".",
    );
  }
  const waiting = (q?.they_asked ?? []).filter((x) => !x.answer);
  if (waiting.length) {
    parts.push(
      `They are waiting on an answer to: ${waiting.map((x) => `"${x.question}"`).join("; ")}.`,
    );
  }
  return parts.join(" ");
}

function describeWork(work?: { doing: WorkItem[]; awaitingConfirmation: WorkItem[] }): string {
  const parts: string[] = [];
  if (work?.doing?.length) {
    parts.push(
      "Jobs they are doing right now: " +
        work.doing
          .map((j) => `[job ${j.id}] ${j.title}${j.budget_usd ? ` for $${j.budget_usd}` : ""}${j.status === "done_pending" ? " - they marked it done, waiting on the requester" : ""}`)
          .join("; ") +
        ". When they say one is finished, call mark_task_done with that job id.",
    );
  }
  if (work?.awaitingConfirmation?.length) {
    parts.push(
      "Waiting on them to confirm somebody finished: " +
        work.awaitingConfirmation
          .map((j) => `[job ${j.id}] ${j.title}${j.budget_usd ? ` for $${j.budget_usd}` : ""}`)
          .join("; ") +
        ". Confirming with confirm_task_done is what records the money as owed, so only do it when they actually say it was done.",
    );
  }
  return parts.join(" ");
}

function systemPrompt(
  openJobs: OpenJob[] = [],
  displayName?: string | null,
  myOrders: MyOrder[] = [],
  openCounters: OpenCounter[] = [],
  replyContext?: string,
  questions?: { waiting_on_them: JobQuestion[]; they_asked: JobQuestion[] },
  work?: { doing: WorkItem[]; awaitingConfirmation: WorkItem[] },
  wallet?: { public_key: string; funded: boolean } | null,
  isNewConversation?: boolean,
): string {
  const who = displayName
    ? `You are talking to ${displayName}. Use their name naturally, not in every message.`
    : "You do not know this person's name yet. If it comes up naturally, you can ask.";
  const voice = config.voiceCallNumber
    ? `If the request is complicated or they would rather talk it through, tell them they can call ${config.voiceCallNumber} and your voice agent will pick up where this left off.`
    : `Voice calling is not switched on yet, so never offer a phone number or invite them to call.`;
  const walletIntro =
    isNewConversation && wallet?.funded
      ? "This is the first message you have ever gotten from this person, so briefly welcome them and mention, in passing, that they have been set up with 50 railcoins to get started - do not dwell on it or explain the mechanics, just fold it into the welcome."
      : "";

  return [
    "You are Gotchu, a personal assistant for one CMU student, reached over text message.",
    who,
    walletIntro,
    CAMPUS_CONTEXT,
    `Reply in at most ${config.maxReplyChars} characters of plain text: one or two short sentences, no markdown, no bullet points, no sign-off.`,
    "Your job is to understand what they need done and submit it as a request. Ask at most one short question per message, and only when something essential is missing.",
    "If they do not name a price, that is fine - submit with budget 0 and say you left the price open.",
    "Once submitted, confirm in one sentence what you submitted.",
    voice,
    "They can both ask for things and do things for other people, and can have several of each going at once.",
    describeOpenJobs(openJobs),
    describeMyRequests(myOrders),
    describeCounters(openCounters),
    describeQuestions(questions),
    describeWork(work),
    "If they are unsure about something on an offered job, ask the requester right away with ask_about_job instead of guessing or leaving it hanging.",
    replyContext
      ? `${replyContext} Treat that as what they are answering - do not ask which one they mean.`
      : "",
    "If they name a price they would do an offered job for, that is a counter-offer: call counter_offer with the offer id and the amount, and tell them it is with the requester. Do not talk them into passing when they are really haggling.",
    "If they can do the job but need more time, call counter_offer at the offered price and put the extra time in the note. Do not accept a job they said they cannot finish by the deadline.",
    "Photos they send are attached for you to look at, so describe or use what you actually see. If a note says an attachment could not be opened, say so plainly rather than guessing.",
    "You only ever see and act on this one person's information. Never mention other users, other requests, or anything about the wider system.",
    "This is an early beta. If you cannot do something, say so plainly in one sentence.",
  ].join(" ");
}

type ResponseItem = { type: string; name?: string; arguments?: string; call_id?: string };

function ago(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Stored history into model input. Tool turns replay as assistant notes - the
 * API takes user/assistant/system, and this is how the agent remembers what it
 * actually did rather than only what it said.
 */
function toModelInput(turns: Turn[]): any[] {
  const now = Date.now();
  return turns.map((t) => {
    const age = t.at ? now - new Date(t.at).getTime() : 0;
    const stamp = age > 5 * 60 * 1000 ? `[${ago(age)} ago] ` : "";
    if (t.role === "tool") {
      return { role: "assistant", content: `${stamp}[did: ${t.name}] ${t.content}` };
    }
    return { role: t.role, content: stamp + t.content };
  });
}

async function callModel(
  input: unknown[],
  openJobs: OpenJob[],
  displayName?: string | null,
  myOrders: MyOrder[] = [],
  openCounters: OpenCounter[] = [],
  replyContext?: string,
  questions?: { waiting_on_them: JobQuestion[]; they_asked: JobQuestion[] },
  work?: { doing: WorkItem[]; awaitingConfirmation: WorkItem[] },
  wallet?: { public_key: string; funded: boolean } | null,
  isNewConversation?: boolean,
): Promise<any> {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      instructions: systemPrompt(
        openJobs, displayName, myOrders, openCounters, replyContext, questions, work,
        wallet, isNewConversation,
      ),
      input,
      tools: TOOL_SCHEMAS,
      max_output_tokens: 1200,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`model HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

function extractText(body: any): string {
  const parts: string[] = [];
  for (const item of body.output ?? []) {
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if ((part.type === "output_text" || part.type === "text") && part.text) parts.push(part.text);
      }
    }
  }
  return parts.join("\n").trim();
}

/** Execute a tool with the phone number bound from the inbound message. */
async function runTool(name: string, args: any, phone: string): Promise<unknown> {
  if (name === "submit_request") {
    const order = await mcp.submitOrder({
      phone, // bound, never model-supplied
      source: "imessage",
      title: args.title,
      details: args.details,
      category: args.category || undefined,
      pickup_location: args.pickup_location || undefined,
      dropoff_location: args.dropoff_location || undefined,
      deadline_at: args.deadline_at || undefined,
      budget_usd: args.budget_usd > 0 ? args.budget_usd : undefined,
      urgency: args.urgency || undefined,
    });
    return order;
  }
  if (name === "get_my_activity") {
    const [who, jobs] = await Promise.all([mcp.identifyCaller(phone), market.openJobs(phone)]);
    return {
      recent_orders: who.recent_orders,
      open_call_id: who.open_call_id,
      open_job_offers: jobs,
    };
  }
  if (name === "set_availability") {
    return await mcp.setWorkerProfile({
      phone, // bound, never model-supplied
      is_available: args.is_available,
      blurb: args.blurb || undefined,
      categories: args.categories?.length ? args.categories : undefined,
      min_price_usd: args.min_price_usd > 0 ? args.min_price_usd : undefined,
    });
  }
  if (name === "mark_task_done") {
    return await market.markDone(String(args.order_id), phone);
  }
  if (name === "confirm_task_done") {
    return await market.confirmDone(
      String(args.order_id), phone, Boolean(args.confirmed), args.note || undefined,
    );
  }
  if (name === "ask_about_job") {
    const jobs = await market.openJobs(phone);
    const target = jobs.find((j) => String(j.id) === String(args.offer_id));
    // Fall through to the id given: they may be asking about a job they took.
    return await market.askAboutJob(String(target?.id ?? args.offer_id), phone, args.question);
  }
  if (name === "answer_job_question") {
    return await market.answerQuestion(String(args.question_id), phone, args.answer);
  }
  if (name === "counter_offer") {
    // Only offers actually made to this phone can be countered.
    const jobs = await market.openJobs(phone);
    const target = jobs.find((j) => String(j.id) === String(args.offer_id));
    if (!target) return { error: "That job offer is not open for you." };

    // The market-maker decides the number, not this agent and not the worker.
    const onTable = Number(target.offered_usd ?? target.budget_usd ?? 0);
    const verdict = await evaluateDeal({
      order: {
        title: target.title,
        details: target.details,
        budget_usd: target.budget_usd,
        deadline_at: target.deadline_at,
        pickup_location: target.pickup_location,
        dropoff_location: target.dropoff_location,
      },
      current_offer_usd: onTable,
      decision: "COUNTER",
      price_usd: args.price_usd,
      note: args.note || undefined,
    });

    // Broker unreachable: fall back to putting it to the requester.
    if (!verdict) {
      return await market.counter(target.id, phone, args.price_usd, args.note || undefined);
    }

    if (verdict.action === "REJECT_SCOPE" || verdict.action === "TRY_NEXT") {
      // Do not relay the note - it is a different job, or the haggling is over.
      await market.respond(target.id, false).catch(() => null);
      return {
        status: verdict.action.toLowerCase(),
        say: verdict.messageHint,
        note: "Offer closed for this person; the task goes to someone else.",
      };
    }
    if (verdict.action === "ACCEPT" && verdict.agreedUsd != null) {
      // Record it at the broker's number. It is inside the auto band, so the
      // requester's own agent settles it within seconds via AUTO_REQUESTER -
      // the worker's view has no business holding the requester's phone.
      await market.counter(target.id, phone, verdict.agreedUsd, args.note || undefined);
      return {
        status: "agreed_pending_settlement",
        agreed_usd: verdict.agreedUsd,
        say: verdict.messageHint,
      };
    }
    if (verdict.action === "COUNTER" && verdict.nextOfferUsd != null) {
      // Counter back to the worker at the broker's number; the requester is
      // not asked yet.
      await market.setOfferPrice(target.id, verdict.nextOfferUsd).catch(() => null);
      return { status: "countered_back", offer_usd: verdict.nextOfferUsd, say: verdict.messageHint };
    }
    // ASK_REQUESTER, or anything unexpected: put it to the requester.
    return await market.counter(target.id, phone, args.price_usd, args.note || undefined);
  }
  if (name === "respond_to_counter") {
    // The requester's own yes or no still goes past the broker, so its record
    // of what cleared stays right.
    const pending = (await market.openCounters(phone)).find(
      (c) => String(c.id) === String(args.offer_id),
    );
    if (pending) {
      await evaluateDeal({
        order: { title: pending.title, budget_usd: pending.budget_usd },
        current_offer_usd: Number(pending.budget_usd ?? 0),
        decision: args.accept ? "REQUESTER_YES" : "REQUESTER_NO",
        price_usd: Number(pending.counter_price_usd ?? 0),
      }).catch(() => null);
    }
    // The phone is bound, so they can only answer counters on their own tasks.
    return await market.respondToCounter(String(args.offer_id), phone, Boolean(args.accept));
  }
  if (name === "update_request") {
    return await mcp.updateOrder({
      phone, // bound, so they can only change their own
      order_id: args.request_id,
      budget_usd: args.budget_usd > 0 ? args.budget_usd : undefined,
      deadline_at: args.deadline_at || undefined,
      details: args.details || undefined,
    });
  }
  if (name === "respond_to_job") {
    // Only offers actually made to this phone are answerable.
    const jobs = await market.openJobs(phone);
    const target = jobs.find((j) => String(j.id) === String(args.offer_id));
    if (!target) return { error: "That job offer is not open for you." };

    // Tell the broker either way, so its view of the market stays current.
    const verdict = await evaluateDeal({
      order: { title: target.title, budget_usd: target.budget_usd, details: target.details },
      current_offer_usd: Number(target.offered_usd ?? target.budget_usd ?? 0),
      decision: args.accept ? "ACCEPT" : "DECLINE",
    });
    if (args.accept && verdict && verdict.action === "REJECT_SCOPE") {
      await market.respond(target.id, false).catch(() => null);
      return { status: "rejected_scope", say: verdict.messageHint };
    }
    return await market.respond(target.id, Boolean(args.accept));
  }
  throw new Error(`unknown tool ${name}`);
}

export async function respond(
  phone: string,
  message: string,
  history: Turn[],
  images: string[] = [],
  skippedAttachments: string[] = [],
  openJobs: OpenJob[] = [],
  displayName?: string | null,
  myOrders: MyOrder[] = [],
  openCounters: OpenCounter[] = [],
  replyContext?: string,
  questions?: { waiting_on_them: JobQuestion[]; they_asked: JobQuestion[] },
  work?: { doing: WorkItem[]; awaitingConfirmation: WorkItem[] },
  wallet?: { public_key: string; funded: boolean } | null,
  isNewConversation?: boolean,
): Promise<{ reply: string; usedTools: string[]; toolTurns: Turn[] }> {
  // Images ride on the current turn only; stored history stays text so the
  // conversation row doesn't fill up with base64.
  const current =
    images.length || skippedAttachments.length
      ? {
          role: "user",
          content: [
            { type: "input_text", text: message },
            ...images.map((dataUri) => ({ type: "input_image", image_url: dataUri })),
            ...(skippedAttachments.length
              ? [{
                  type: "input_text",
                  text: `[Could not open: ${skippedAttachments.join(", ")}. Say so briefly.]`,
                }]
              : []),
          ],
        }
      : { role: "user", content: message };

  const input: any[] = [...toModelInput(history), current];
  const usedTools: string[] = [];
  const toolTurns: Turn[] = [];

  for (let i = 0; i < config.maxToolIterations; i++) {
    const body = await callModel(
      input, openJobs, displayName, myOrders, openCounters, replyContext, questions, work,
      wallet, isNewConversation,
    );
    const items: ResponseItem[] = body.output ?? [];
    const calls = items.filter((o) => o.type === "function_call");

    if (calls.length === 0) {
      const text = extractText(body);
      if (text) return { reply: text, usedTools, toolTurns };
      break;
    }

    input.push(...items);
    for (const call of calls) {
      usedTools.push(call.name ?? "unknown");
      let output: string;
      try {
        const result = await runTool(call.name!, JSON.parse(call.arguments || "{}"), phone);
        output = JSON.stringify(result);
      } catch (err) {
        output = JSON.stringify({ error: (err as Error).message });
      }
      input.push({ type: "function_call_output", call_id: call.call_id, output });
      toolTurns.push({
        role: "tool",
        name: call.name,
        content: `${(call.arguments || "{}").slice(0, 300)} -> ${output.slice(0, 300)}`,
        at: new Date().toISOString(),
      });
    }
  }

  // Ship rule: never leave a text unanswered because the model misbehaved.
  return {
    reply: "Got your message - I'm on it. Say a bit more about what you need and by when?",
    usedTools,
    toolTurns,
  };
}
