import { z } from "zod";
import { pool, normalizePhone, upsertPerson } from "./db.js";
import {
  listOpenOffers, listOpenTasks, resolveOffer,
  counterOffer, respondToCounter, listOpenCounters,
  askAboutJob, answerJobQuestion, listOpenQuestions, listMyQuestions,
} from "./marketplace.js";

/**
 * One definition per tool, shared by the MCP transport and the REST mirror.
 * `shape` is a Zod raw shape so it can be handed straight to registerTool.
 */
export type ToolDef = {
  name: string;
  title: string;
  description: string;
  shape: z.ZodRawShape;
  handler: (input: any) => Promise<unknown>;
};

const RESOLUTION_STATUS = [
  "order_submitted",
  "answered_question",
  "needs_followup",
  "no_action",
] as const;

export const tools: ToolDef[] = [
  {
    name: "identify_caller",
    title: "Identify caller",
    description:
      "Everything known about the person on this number: the tasks they have asked for and where each stands, jobs they have been offered, counter-offers and questions waiting on them, whether they take work themselves, and what past calls covered. Call this first with the number from caller ID, and use what comes back instead of asking them things the system already knows.",
    shape: {
      phone: z.string().describe("Caller's number from caller ID, in any format"),
      display_name: z.string().optional().describe("Name if they give one"),
    },
    handler: async ({ phone, display_name }) => {
      const e164 = normalizePhone(phone);
      const person = await upsertPerson(e164, display_name);

      const [orders, openCall, worker, pastCalls, offers, counters, askedOfThem, theyAsked] =
        await Promise.all([
          pool.query(
            `SELECT o.id, o.title, o.status, o.budget_usd, o.category, o.deadline_at,
                    o.created_at, w.phone AS being_done_by
               FROM orders o
               LEFT JOIN people w ON w.id = o.accepted_by
              WHERE o.person_id = $1
              ORDER BY o.created_at DESC LIMIT 8`,
            [person.id],
          ),
          pool.query(
            `SELECT id, started_at FROM calls
              WHERE caller_phone = $1 AND status = 'open'
              ORDER BY started_at DESC LIMIT 1`,
            [e164],
          ),
          pool.query(
            `SELECT is_available, blurb, categories, min_price_usd, auto_counter, auto_accept
               FROM worker_profiles WHERE phone = $1`,
            [e164],
          ),
          pool.query(
            `SELECT id, started_at, summary, resolution, resolution_status
               FROM calls WHERE caller_phone = $1 AND status = 'completed'
              ORDER BY started_at DESC LIMIT 3`,
            [e164],
          ),
          listOpenOffers(e164),
          listOpenCounters(e164),
          listOpenQuestions(e164),
          listMyQuestions(e164),
        ]);

      const live = orders.rows.filter((o: { status: string }) =>
        ["submitted", "offered", "accepted"].includes(o.status),
      );

      return {
        person_id: person.id,
        phone: e164,
        display_name: person.display_name,
        known_caller: (orders.rowCount ?? 0) > 0,
        open_call_id: openCall.rows[0]?.id ?? null,

        // Tasks they asked for.
        open_requests: live,
        recent_orders: orders.rows,

        // Work they could pick up.
        is_worker: (worker.rowCount ?? 0) > 0,
        worker_profile: worker.rows[0] ?? null,
        job_offers_held: offers,

        // Waiting on a decision or an answer from them.
        counters_awaiting_them: counters,
        questions_awaiting_them: askedOfThem,
        answers_they_received: theyAsked.filter((q: { answer?: string | null }) => q.answer),

        previous_calls: pastCalls.rows,
      };
    },
  },

  {
    name: "start_call",
    title: "Start call",
    description:
      "Open a call record at the beginning of the conversation. Returns a call_id that every later tool call in this conversation must reference. Pass the number from caller ID, never a number the caller reads out.",
    shape: {
      phone: z.string().describe("Caller's number from caller ID, in E.164"),
      external_call_id: z
        .string()
        .optional()
        .describe("The voice platform's own call id, for cross-referencing"),
      agent: z.string().optional().describe("Which voice agent is handling the call"),
    },
    handler: async ({ phone, external_call_id, agent }) => {
      const e164 = normalizePhone(phone);
      const person = await upsertPerson(e164);
      const { rows } = await pool.query(
        `INSERT INTO calls (person_id, caller_phone, agent, external_call_id)
         VALUES ($1, $2, COALESCE($3, 'grok-voice'), $4)
         RETURNING id, started_at`,
        [person.id, e164, agent ?? null, external_call_id ?? null],
      );
      return { call_id: rows[0].id, person_id: person.id, started_at: rows[0].started_at };
    },
  },

  {
    name: "log_call_note",
    title: "Log call note",
    description:
      "Record something that was said or decided during the call. Log as you go, not at the end — this is the transcript the text-message agent reads later.",
    shape: {
      call_id: z.string().describe("From start_call"),
      speaker: z.enum(["caller", "agent"]),
      text: z.string().describe("What was said, or the decision made"),
      kind: z
        .enum(["utterance", "note", "decision"])
        .optional()
        .describe("Defaults to utterance"),
    },
    handler: async ({ call_id, speaker, text, kind }) => {
      const { rows } = await pool.query(
        `INSERT INTO call_notes (call_id, speaker, kind, text)
         VALUES ($1, $2, COALESCE($3, 'utterance'), $4) RETURNING id, at`,
        [call_id, speaker, kind ?? null, text],
      );
      return { note_id: rows[0].id, at: rows[0].at };
    },
  },

  {
    name: "submit_order",
    title: "Submit order",
    description:
      "Submit the detailed request the caller described. Only call this once you have a title, what they actually need, and either a budget or an explicit 'no budget given'. This is the handoff to the personal agent. On a call, pass call_id and leave phone out: the number is taken from caller ID, which is more reliable than a number heard over the phone.",
    shape: {
      phone: z
        .string()
        .optional()
        .describe("Only when there is no call_id. On a call, omit this and pass call_id."),
      title: z.string().describe("Short summary, e.g. 'Package pickup: UC to Gates'"),
      details: z.string().describe("Everything they said about what they need, in their own terms"),
      call_id: z.string().optional().describe("From start_call, when this came from a call"),
      category: z.string().optional().describe("e.g. pickup, food, errand, moving, tutoring"),
      pickup_location: z.string().optional(),
      dropoff_location: z.string().optional(),
      deadline_at: z
        .string()
        .optional()
        .describe("ISO 8601 timestamp. Convert 'before 6' to an absolute time."),
      budget_usd: z.number().optional().describe("What they are willing to pay"),
      urgency: z.enum(["now", "today", "this_week", "whenever"]).optional(),
      source: z
        .enum(["voice", "imessage", "web"])
        .optional()
        .describe("Where the request came from. Defaults to voice."),
      requirements: z
        .array(z.string())
        .optional()
        .describe("Anything the worker must have or do, one per item"),
    },
    handler: async (input) => {
      // Caller ID beats transcription. A number heard over a phone line is
      // easily mangled; the call record already knows who is on the line.
      let e164: string | null = null;
      if (input.call_id) {
        const call = await pool.query(`SELECT caller_phone FROM calls WHERE id = $1`, [
          input.call_id,
        ]);
        e164 = call.rows[0]?.caller_phone ?? null;
      }
      if (!e164) {
        if (!input.phone) {
          throw new Error("Pass call_id (preferred, uses caller ID) or a phone number.");
        }
        e164 = normalizePhone(input.phone);
      }
      const person = await upsertPerson(e164);

      // A voice agent mid-call often omits call_id. Attach it to their open
      // call anyway, so the call and the order it produced stay connected.
      let callId: string | null = input.call_id ?? null;
      if (!callId) {
        const open = await pool.query(
          `SELECT id FROM calls WHERE caller_phone = $1 AND status = 'open'
            ORDER BY started_at DESC LIMIT 1`,
          [e164],
        );
        callId = open.rows[0]?.id ?? null;
      }

      const { rows } = await pool.query(
        `INSERT INTO orders (person_id, call_id, source, title, details, category,
                             pickup_location, dropoff_location, deadline_at,
                             budget_usd, urgency, requirements)
         VALUES ($1,$2,$12,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         RETURNING *`,
        [
          person.id,
          callId,
          input.title,
          input.details,
          input.category ?? null,
          input.pickup_location ?? null,
          input.dropoff_location ?? null,
          input.deadline_at ?? null,
          input.budget_usd ?? null,
          input.urgency ?? null,
          JSON.stringify(input.requirements ?? []),
          input.source ?? "voice",
        ],
      );
      const order = rows[0];

      // Queue the confirmation the text agent will send.
      await pool.query(
        `INSERT INTO agent_handoffs (person_id, phone, call_id, order_id, kind, payload)
         VALUES ($1,$2,$3,$4,'order_confirmation',$5::jsonb)`,
        [
          person.id,
          e164,
          callId,
          order.id,
          JSON.stringify({ title: order.title, budget_usd: order.budget_usd }),
        ],
      );
      return { order_id: order.id, status: order.status, created_at: order.created_at };
    },
  },

  {
    name: "complete_call",
    title: "Complete call",
    description:
      "Close the call with a summary and how it resolved. Always call this before hanging up — it is what lets the caller's text thread pick up where the call left off.",
    shape: {
      call_id: z.string(),
      summary: z.string().describe("2-3 sentences on what the caller wanted and what happened"),
      resolution: z.string().describe("The outcome, in terms the caller would recognize"),
      resolution_status: z.enum(RESOLUTION_STATUS),
    },
    handler: async ({ call_id, summary, resolution, resolution_status }) => {
      const { rows } = await pool.query(
        `UPDATE calls
            SET status = 'completed', ended_at = now(),
                summary = $2, resolution = $3, resolution_status = $4
          WHERE id = $1
          RETURNING id, person_id, caller_phone`,
        [call_id, summary, resolution, resolution_status],
      );
      if (!rows[0]) throw new Error(`No call ${call_id}`);
      const call = rows[0];

      await pool.query(
        `INSERT INTO agent_handoffs (person_id, phone, call_id, kind, payload)
         VALUES ($1,$2,$3,'call_summary',$4::jsonb)`,
        [
          call.person_id,
          call.caller_phone,
          call.id,
          JSON.stringify({ summary, resolution, resolution_status }),
        ],
      );
      return { call_id: call.id, status: "completed", handoff_queued: true };
    },
  },

  {
    name: "get_call",
    title: "Get call",
    description:
      "Read back a call: its summary, resolution, every note logged, and any orders it produced. Use it to resume a dropped call or to answer 'what did we say last time'.",
    shape: { call_id: z.string() },
    handler: async ({ call_id }) => {
      const [call, notes, orders] = await Promise.all([
        pool.query(`SELECT * FROM calls WHERE id = $1`, [call_id]),
        pool.query(
          `SELECT speaker, kind, text, at FROM call_notes WHERE call_id = $1 ORDER BY at`,
          [call_id],
        ),
        pool.query(
          `SELECT id, title, status, budget_usd FROM orders WHERE call_id = $1`,
          [call_id],
        ),
      ]);
      if (!call.rows[0]) throw new Error(`No call ${call_id}`);
      return { call: call.rows[0], notes: notes.rows, orders: orders.rows };
    },
  },
];

tools.push({
  name: "set_worker_profile",
  title: "Set worker profile",
  description:
    "Record that this person is willing to pick up jobs, and what kind. Use it when someone says they want to earn, are free, or want to stop getting offers.",
  shape: {
    phone: z.string(),
    is_available: z.boolean().describe("false takes them out of the pool"),
    blurb: z
      .string()
      .optional()
      .describe("In their words: where they are, what they'll do, when they're free"),
    categories: z
      .array(z.string())
      .optional()
      .describe("pickup, food, errand, moving, tutoring, design, other"),
    min_price_usd: z.number().optional().describe("Lowest they'll work for"),
    auto_counter: z
      .boolean()
      .optional()
      .describe("May their agent counter below-minimum offers for them? Default yes."),
    auto_accept: z
      .boolean()
      .optional()
      .describe("May their agent take jobs at or above their minimum without asking? Default no."),
  },
  handler: async (input) => {
    const e164 = normalizePhone(input.phone);
    const person = await upsertPerson(e164);
    const { rows } = await pool.query(
      `INSERT INTO worker_profiles (person_id, phone, is_available, blurb, categories,
                                    min_price_usd, auto_counter, auto_accept, updated_at)
       VALUES ($1,$2,$3,$4,$5::text[],$6,COALESCE($7,true),COALESCE($8,false), now())
       ON CONFLICT (person_id) DO UPDATE
         SET is_available = EXCLUDED.is_available,
             blurb = COALESCE(EXCLUDED.blurb, worker_profiles.blurb),
             categories = CASE WHEN cardinality(EXCLUDED.categories) > 0
                               THEN EXCLUDED.categories ELSE worker_profiles.categories END,
             min_price_usd = COALESCE(EXCLUDED.min_price_usd, worker_profiles.min_price_usd),
             auto_counter = COALESCE($7, worker_profiles.auto_counter),
             auto_accept = COALESCE($8, worker_profiles.auto_accept),
             updated_at = now()
       RETURNING phone, is_available, blurb, categories, min_price_usd, auto_counter, auto_accept`,
      [
        person.id,
        e164,
        input.is_available,
        input.blurb ?? null,
        input.categories ?? [],
        input.min_price_usd ?? null,
        input.auto_counter ?? null,
        input.auto_accept ?? null,
      ],
    );
    return rows[0];
  },
});

tools.push({
  name: "list_job_offers",
  title: "List job offers",
  description:
    "Jobs this person has been offered and not yet answered. They can be holding several at once, so read them the list before assuming which one they mean.",
  shape: { phone: z.string() },
  handler: async ({ phone }) => ({ offers: await listOpenOffers(phone) }),
});

tools.push({
  name: "respond_to_job_offer",
  title: "Respond to a job offer",
  description:
    "Take or turn down one job on this person's behalf. Pass the offer id from list_job_offers. If they are holding more than one and it is unclear which they mean, ask first.",
  shape: {
    phone: z.string(),
    offer_id: z.union([z.string(), z.number()]),
    accept: z.boolean(),
  },
  handler: async ({ phone, offer_id, accept }) =>
    await resolveOffer(offer_id, accept, phone),
});

tools.push({
  name: "ask_about_job",
  title: "Ask the requester about a job",
  description:
    "Ask the person who requested a task a question about it, on behalf of whoever is doing or considering it. Use it the moment something is unclear - which building, which desk, what exactly is needed - instead of guessing or stalling.",
  shape: {
    phone: z.string().describe("The person asking, who holds the offer"),
    offer_id: z.union([z.string(), z.number()]),
    question: z.string().describe("The question in plain words, as they would ask it"),
  },
  handler: async ({ phone, offer_id, question }) =>
    await askAboutJob(offer_id, phone, question),
});

tools.push({
  name: "answer_job_question",
  title: "Answer a question about your task",
  description:
    "The person who requested a task answers a question someone asked about it. The asker is told immediately.",
  shape: {
    phone: z.string().describe("The requester answering"),
    question_id: z.union([z.string(), z.number()]),
    answer: z.string(),
  },
  handler: async ({ phone, question_id, answer }) =>
    await answerJobQuestion(question_id, phone, answer),
});

tools.push({
  name: "list_job_questions",
  title: "List job questions",
  description:
    "Questions waiting on this person about tasks they requested, plus questions they themselves asked and any answers.",
  shape: { phone: z.string() },
  handler: async ({ phone }) => ({
    waiting_on_them: await listOpenQuestions(phone),
    they_asked: await listMyQuestions(phone),
  }),
});

tools.push({
  name: "counter_offer",
  title: "Counter a job offer",
  description:
    "Propose a different price for a job this person was offered, instead of taking it or passing. The person who asked for the task then decides.",
  shape: {
    phone: z.string(),
    offer_id: z.union([z.string(), z.number()]),
    price_usd: z.number().describe("What they want to be paid"),
    note: z.string().optional().describe("Anything they said about why, in their words"),
  },
  handler: async ({ phone, offer_id, price_usd, note }) =>
    await counterOffer(offer_id, phone, price_usd, note),
});

tools.push({
  name: "respond_to_counter",
  title: "Answer a counter-offer",
  description:
    "The person who asked for a task accepts or turns down a worker's counter-offer. Accepting sets the new price and gives them the job.",
  shape: {
    phone: z.string(),
    offer_id: z.union([z.string(), z.number()]),
    accept: z.boolean(),
  },
  handler: async ({ phone, offer_id, accept }) =>
    await respondToCounter(offer_id, accept, phone),
});

tools.push({
  name: "list_counters",
  title: "List counter-offers",
  description:
    "Counter-offers waiting on this person's decision, for tasks they asked for.",
  shape: { phone: z.string() },
  handler: async ({ phone }) => ({ counters: await listOpenCounters(phone) }),
});

tools.push({
  name: "update_order",
  title: "Update a request",
  description:
    "Change the price, deadline or details on a request this person made themselves. Use it when they want different terms on their own task.",
  shape: {
    phone: z.string(),
    order_id: z.string(),
    budget_usd: z.number().optional(),
    deadline_at: z.string().optional(),
    details: z.string().optional(),
  },
  handler: async ({ phone, order_id, budget_usd, deadline_at, details }) => {
    const e164 = normalizePhone(phone);
    const { rows } = await pool.query(
      `UPDATE orders o
          SET budget_usd = COALESCE($3, o.budget_usd),
              deadline_at = COALESCE($4::timestamptz, o.deadline_at),
              details = COALESCE($5, o.details),
              updated_at = now()
        FROM people p
       WHERE o.id = $1 AND o.person_id = p.id AND p.phone = $2
         AND o.status IN ('submitted', 'offered')
       RETURNING o.id, o.title, o.budget_usd, o.deadline_at, o.status`,
      [order_id, e164, budget_usd ?? null, deadline_at ?? null, details ?? null],
    );
    if (!rows[0]) {
      return { error: "That request is not one of theirs, or is no longer open." };
    }
    return rows[0];
  },
});

tools.push({
  name: "list_open_tasks",
  title: "List open tasks",
  description:
    "Tasks currently looking for someone to do them. Use it when a caller asks what work is available.",
  shape: {},
  handler: async () => ({ tasks: await listOpenTasks() }),
});

export const toolsByName = new Map(tools.map((t) => [t.name, t]));
