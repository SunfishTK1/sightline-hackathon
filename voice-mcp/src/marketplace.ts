import { pool, normalizePhone, upsertPerson } from "./db.js";

/** Every job this person is being asked about. They may hold several at once. */
export async function listOpenOffers(phone: string) {
  const { rows } = await pool.query(
    `SELECT j.id, j.reason, j.offered_usd, o.id AS order_id, o.title, o.details, o.budget_usd,
            o.deadline_at, o.pickup_location, o.dropoff_location
       FROM job_offers j
       JOIN orders o ON o.id = j.order_id
      WHERE j.phone = $1 AND j.status = 'offered' AND j.outreach_sent_at IS NOT NULL
      ORDER BY j.created_at
      LIMIT 10`,
    [normalizePhone(phone)],
  );
  return rows;
}

/** Tasks still looking for someone. */
export async function listOpenTasks() {
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.details, o.category, o.pickup_location, o.dropoff_location,
            o.deadline_at, o.budget_usd, o.urgency, o.created_at
       FROM orders o
      WHERE o.status IN ('submitted', 'offered')
      ORDER BY o.created_at DESC
      LIMIT 20`,
  );
  return rows;
}

/**
 * Accept or decline one offer. Shared by the REST route and the MCP tool so
 * there is exactly one place where an order changes hands.
 *
 * When `phone` is given the offer must belong to that person - a voice agent
 * must never be able to answer somebody else's offer.
 */
export async function resolveOffer(
  offerId: string | number,
  accepted: boolean,
  phone?: string,
): Promise<{ status: string; order_id?: string; error?: string }> {
  const guard = phone ? normalizePhone(phone) : null;
  const { rows } = await pool.query(
    `UPDATE job_offers
        SET status = $2, responded_at = now()
      WHERE id = $1 AND status = 'offered'
        AND ($3::text IS NULL OR phone = $3)
      RETURNING id, order_id, person_id, phone`,
    [offerId, accepted ? "accepted" : "declined", guard],
  );
  const offer = rows[0];
  if (!offer) return { status: "unchanged", error: "That offer is not open for this person." };

  if (!accepted) {
    await pool.query(
      `UPDATE orders SET status = 'submitted', updated_at = now() WHERE id = $1`,
      [offer.order_id],
    );
    return { status: "declined", order_id: offer.order_id };
  }

  const order = await pool.query(
    `UPDATE orders
        SET status = 'accepted', accepted_by = $2, accepted_at = now(), updated_at = now()
      WHERE id = $1
      RETURNING id, title, person_id`,
    [offer.order_id, offer.person_id],
  );
  // Nobody else is still on the hook for this one.
  await pool.query(
    `UPDATE job_offers SET status = 'cancelled', responded_at = now()
      WHERE order_id = $1 AND id <> $2 AND status = 'offered'`,
    [offer.order_id, offer.id],
  );

  const requester = await pool.query(`SELECT id, phone FROM people WHERE id = $1`, [
    order.rows[0].person_id,
  ]);
  if (requester.rows[0]) {
    await pool.query(
      `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
       VALUES ($1,$2,$3,'worker_accepted',$4::jsonb)`,
      [
        requester.rows[0].id,
        requester.rows[0].phone,
        offer.order_id,
        JSON.stringify({ title: order.rows[0].title, worker_phone: offer.phone }),
      ],
    );
  }
  return { status: "accepted", order_id: offer.order_id };
}

/**
 * Move an order to the person who actually asked for it. Needed when a number
 * was mis-heard on a call and the task landed under a stranger.
 */
export async function reassignOrder(
  orderId: string,
  phone: string,
): Promise<{ status: string; error?: string; title?: string; requester?: string }> {
  const e164 = normalizePhone(phone);
  const person = await upsertPerson(e164);
  const { rows } = await pool.query(
    `UPDATE orders SET person_id = $2, updated_at = now()
      WHERE id = $1
      RETURNING id, title, status`,
    [orderId, person.id],
  );
  if (!rows[0]) return { status: "unchanged", error: "No order with that id." };
  return { status: "reassigned", title: rows[0].title, requester: e164 };
}

// ---------------------------------------------------------------- counters

/**
 * A worker proposes different terms. The offer is held open but is no longer
 * theirs to simply accept - the requester decides.
 */
/** Two rounds of haggling, a warning on the third, cancelled on a fourth. */
const WARN_AT_ROUND = 3;
const CANCEL_AFTER_ROUND = 3;

export async function counterOffer(
  offerId: string | number,
  phone: string,
  priceUsd: number,
  note?: string,
): Promise<{
  status: string; error?: string; counter_price_usd?: number; final_round?: boolean;
}> {
  const { rows } = await pool.query(
    `UPDATE job_offers
        SET status = 'countered', counter_price_usd = $3, counter_note = $4,
            countered_at = now(), counter_rounds = counter_rounds + 1
      WHERE id = $1 AND phone = $2 AND status = 'offered'
      RETURNING id, order_id, phone, counter_price_usd, counter_rounds`,
    [offerId, normalizePhone(phone), priceUsd, note ?? null],
  );
  const offer = rows[0];
  if (!offer) return { status: "unchanged", error: "That offer is not open for this person." };

  const order = await pool.query(
    `SELECT o.id, o.title, o.budget_usd, p.id AS requester_id, p.phone AS requester_phone
       FROM orders o JOIN people p ON p.id = o.person_id WHERE o.id = $1`,
    [offer.order_id],
  );
  const o = order.rows[0];
  const rounds = Number(offer.counter_rounds);

  // Past the limit the deal is off for both sides, not just paused.
  if (rounds > CANCEL_AFTER_ROUND) {
    await pool.query(
      `UPDATE job_offers SET status = 'cancelled', responded_at = now() WHERE id = $1`,
      [offer.id],
    );
    const worker = await pool.query(`SELECT id FROM people WHERE phone = $1`, [offer.phone]);
    const payload = JSON.stringify({ title: o?.title, rounds });
    await pool.query(
      `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
       VALUES ($1,$2,$3,'negotiation_cancelled',$4::jsonb)`,
      [worker.rows[0]?.id ?? null, offer.phone, offer.order_id, payload],
    );
    if (o) {
      await pool.query(
        `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
         VALUES ($1,$2,$3,'negotiation_cancelled',$4::jsonb)`,
        [o.requester_id, o.requester_phone, offer.order_id, payload],
      );
    }
    return { status: "cancelled_too_many_rounds" };
  }

  // On the last permitted round, warn the person doing the countering too.
  if (rounds >= WARN_AT_ROUND) {
    const worker = await pool.query(`SELECT id FROM people WHERE phone = $1`, [offer.phone]);
    await pool.query(
      `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
       VALUES ($1,$2,$3,'counter_warning',$4::jsonb)`,
      [
        worker.rows[0]?.id ?? null,
        offer.phone,
        offer.order_id,
        JSON.stringify({ title: o?.title, rounds }),
      ],
    );
  }

  if (o) {
    await pool.query(
      `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
       VALUES ($1,$2,$3,'counter_received',$4::jsonb)`,
      [
        o.requester_id,
        o.requester_phone,
        offer.order_id,
        JSON.stringify({
          title: o.title,
          offer_id: offer.id,
          asking_usd: Number(offer.counter_price_usd),
          original_usd: o.budget_usd ? Number(o.budget_usd) : null,
          note: note ?? null,
          final_round: rounds >= WARN_AT_ROUND,
        }),
      ],
    );
  }
  return {
    status: "countered",
    counter_price_usd: Number(offer.counter_price_usd),
    final_round: rounds >= WARN_AT_ROUND,
  };
}

/** Counters waiting on this requester's decision. */
export async function listOpenCounters(requesterPhone: string) {
  const { rows } = await pool.query(
    `SELECT j.id, j.phone AS worker_phone, j.counter_price_usd, j.counter_note,
            o.id AS order_id, o.title, o.budget_usd
       FROM job_offers j
       JOIN orders o ON o.id = j.order_id
       JOIN people p ON p.id = o.person_id
      WHERE j.status = 'countered' AND p.phone = $1
      ORDER BY j.countered_at
      LIMIT 10`,
    [normalizePhone(requesterPhone)],
  );
  return rows;
}

/**
 * The requester answers a counter. Yes takes the new price and hands over the
 * job; no puts the offer back on the table at the original price, so the
 * worker can still take it as first offered.
 */
export async function respondToCounter(
  offerId: string | number,
  accept: boolean,
  requesterPhone: string,
): Promise<{ status: string; error?: string }> {
  const { rows } = await pool.query(
    `SELECT j.id, j.order_id, j.person_id, j.phone, j.counter_price_usd,
            o.title, o.budget_usd
       FROM job_offers j
       JOIN orders o ON o.id = j.order_id
       JOIN people p ON p.id = o.person_id
      WHERE j.id = $1 AND j.status = 'countered' AND p.phone = $2`,
    [offerId, normalizePhone(requesterPhone)],
  );
  const offer = rows[0];
  if (!offer) return { status: "unchanged", error: "No counter is open on that offer." };

  if (!accept) {
    await pool.query(
      `UPDATE job_offers SET status = 'offered', countered_at = NULL WHERE id = $1`,
      [offer.id],
    );
    await pool.query(
      `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
       VALUES ($1,$2,$3,'counter_declined',$4::jsonb)`,
      [
        offer.person_id,
        offer.phone,
        offer.order_id,
        JSON.stringify({
          title: offer.title,
          asked_usd: Number(offer.counter_price_usd),
          still_offered_usd: offer.budget_usd ? Number(offer.budget_usd) : null,
        }),
      ],
    );
    return { status: "declined" };
  }

  await pool.query(
    `UPDATE orders
        SET budget_usd = $2, status = 'accepted', accepted_by = $3,
            accepted_at = now(), updated_at = now()
      WHERE id = $1`,
    [offer.order_id, offer.counter_price_usd, offer.person_id],
  );
  await pool.query(
    `UPDATE job_offers SET status = 'accepted', responded_at = now() WHERE id = $1`,
    [offer.id],
  );
  await pool.query(
    `UPDATE job_offers SET status = 'cancelled', responded_at = now()
      WHERE order_id = $1 AND id <> $2 AND status IN ('offered', 'countered')`,
    [offer.order_id, offer.id],
  );
  await pool.query(
    `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
     VALUES ($1,$2,$3,'counter_accepted',$4::jsonb)`,
    [
      offer.person_id,
      offer.phone,
      offer.order_id,
      JSON.stringify({ title: offer.title, agreed_usd: Number(offer.counter_price_usd) }),
    ],
  );
  return { status: "accepted" };
}

// ---------------------------------------------------------------- questions

/** A worker's side asks the requester something about the job. */
export async function askAboutJob(
  offerId: string | number,
  phone: string,
  question: string,
): Promise<{ status: string; question_id?: string; error?: string }> {
  const e164 = normalizePhone(phone);
  const { rows } = await pool.query(
    `SELECT j.id, j.order_id, o.title, p.id AS requester_id, p.phone AS requester_phone
       FROM job_offers j
       JOIN orders o ON o.id = j.order_id
       JOIN people p ON p.id = o.person_id
      WHERE j.id = $1 AND j.phone = $2 AND j.status IN ('offered','countered','accepted')`,
    [offerId, e164],
  );
  const offer = rows[0];
  if (!offer) return { status: "unchanged", error: "That job is not one of theirs." };

  const inserted = await pool.query(
    `INSERT INTO job_questions (offer_id, order_id, asker_phone, question)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [offer.id, offer.order_id, e164, question],
  );
  await pool.query(
    `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
     VALUES ($1,$2,$3,'question_asked',$4::jsonb)`,
    [
      offer.requester_id,
      offer.requester_phone,
      offer.order_id,
      JSON.stringify({
        title: offer.title,
        question,
        question_id: String(inserted.rows[0].id),
      }),
    ],
  );
  return { status: "asked", question_id: String(inserted.rows[0].id) };
}

/** The requester answers; the person who asked gets told straight away. */
export async function answerJobQuestion(
  questionId: string | number,
  requesterPhone: string,
  answer: string,
): Promise<{ status: string; error?: string }> {
  const { rows } = await pool.query(
    `UPDATE job_questions q
        SET answer = $3, answered_at = now()
       FROM orders o, people p
      WHERE q.id = $1 AND q.answered_at IS NULL
        AND o.id = q.order_id AND p.id = o.person_id AND p.phone = $2
      RETURNING q.id, q.order_id, q.asker_phone, q.question, o.title`,
    [questionId, normalizePhone(requesterPhone), answer],
  );
  const q = rows[0];
  if (!q) return { status: "unchanged", error: "No open question of theirs with that id." };

  const asker = await pool.query(`SELECT id FROM people WHERE phone = $1`, [q.asker_phone]);
  await pool.query(
    `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
     VALUES ($1,$2,$3,'question_answered',$4::jsonb)`,
    [
      asker.rows[0]?.id ?? null,
      q.asker_phone,
      q.order_id,
      JSON.stringify({ title: q.title, question: q.question, answer }),
    ],
  );
  return { status: "answered" };
}

/** Questions waiting on this requester. */
export async function listOpenQuestions(requesterPhone: string) {
  const { rows } = await pool.query(
    `SELECT q.id, q.question, q.asked_at, q.asker_phone, o.title
       FROM job_questions q
       JOIN orders o ON o.id = q.order_id
       JOIN people p ON p.id = o.person_id
      WHERE q.answered_at IS NULL AND p.phone = $1
      ORDER BY q.asked_at
      LIMIT 10`,
    [normalizePhone(requesterPhone)],
  );
  return rows;
}

/** Questions this person asked, answered or not. */
export async function listMyQuestions(phone: string) {
  const { rows } = await pool.query(
    `SELECT q.id, q.question, q.answer, q.answered_at, o.title
       FROM job_questions q
       JOIN orders o ON o.id = q.order_id
      WHERE q.asker_phone = $1
      ORDER BY q.asked_at DESC
      LIMIT 10`,
    [normalizePhone(phone)],
  );
  return rows;
}

/**
 * Everything an agent could act on for its principal: offers a worker's agent
 * might counter, and counters a requester's agent might settle.
 */
export async function pendingNegotiation() {
  const offers = await pool.query(
    `SELECT j.id, j.phone, j.outreach_sent_at, j.offered_usd, o.title, o.budget_usd,
            o.category, o.details, o.deadline_at, o.pickup_location, o.dropoff_location,
            w.min_price_usd, w.auto_counter, w.auto_accept, w.blurb
       FROM job_offers j
       JOIN orders o ON o.id = j.order_id
       LEFT JOIN worker_profiles w ON w.phone = j.phone
      WHERE j.status = 'offered' AND j.outreach_sent_at IS NOT NULL
      ORDER BY j.outreach_sent_at
      LIMIT 20`,
  );
  const counters = await pool.query(
    `SELECT j.id, j.phone AS worker_phone, j.counter_price_usd, j.countered_at,
            j.offered_usd, o.title, o.budget_usd AS order_budget_usd, p.phone AS requester_phone
       FROM job_offers j
       JOIN orders o ON o.id = j.order_id
       JOIN people p ON p.id = o.person_id
      WHERE j.status = 'countered'
      ORDER BY j.countered_at
      LIMIT 20`,
  );
  return { offers: offers.rows, counters: counters.rows };
}

// ---------------------------------------------------------------- seed data

const DEMO_WORKERS = [
  {
    phone: "+14125550101", name: "Priya",
    blurb: "Usually in Gates or Newell-Simon weekday afternoons. Happy to do coffee and food runs anywhere on the main campus.",
    categories: ["food", "pickup"], min: 6,
  },
  {
    phone: "+14125550102", name: "Marcus",
    blurb: "I live in Morewood and I have a car. Fine with moving furniture, mini fridges, big grocery runs. Weekends are easiest.",
    categories: ["moving", "errand"], min: 15,
  },
  {
    phone: "+14125550103", name: "Dana",
    blurb: "Design student in CFA. Quick turnaround on posters, Figma mockups and flyers. Not doing anything that takes more than a few hours.",
    categories: ["design", "other"], min: 20,
  },
  {
    phone: "+14125550104", name: "Wes",
    blurb: "Between classes in Doherty and Wean most days. Package pickups from the UC and deliveries anywhere on the Cut.",
    categories: ["pickup", "errand"], min: 5,
  },
  {
    phone: "+14125550105", name: "Ivy",
    blurb: "I drive to Squirrel Hill and Murray Ave most weekends. Grocery runs and off-campus pickups.",
    categories: ["errand", "food"], min: 12,
  },
  {
    phone: "+14125550106", name: "Sam",
    blurb: "TA for an intro CS course. Happy to explain concepts and walk through material. I will not do anyone's assignment for them.",
    categories: ["tutoring"], min: 25,
  },
  {
    phone: "+14125550107", name: "Rin",
    blurb: "Night owl, usually in Hunt Library until it closes. Late-night food runs and supply runs, including paint for the Fence.",
    categories: ["food", "errand"], min: 8,
  },
];

const DEMO_TASKS = [
  {
    phone: "+14125550201",
    title: "Cold brew from De Fer to Hunt Library",
    details: "Grab a large cold brew from De Fer in Tepper and bring it to the Hunt Library second floor before 4pm.",
    category: "food", pickup: "Tepper Quad", dropoff: "Hunt Library", budget: 7, urgency: "today",
  },
  {
    phone: "+14125550202",
    title: "Move two boxes from Mudge to Fifth and Clyde",
    details: "Two heavy boxes of books, no stairs on either end. Need someone with a car or a very strong back.",
    category: "moving", pickup: "Mudge House", dropoff: "Fifth and Clyde", budget: 20, urgency: "this_week",
  },
  {
    phone: "+14125550203",
    title: "Poster for our Spring Carnival booth",
    details: "Need a printable poster designed for our Booth at Spring Carnival. Tartan colors, has to read from a distance.",
    category: "design", pickup: "", dropoff: "", budget: 35, urgency: "this_week",
  },
];

/**
 * Remove the fictional pool. The +1 412 555 01xx range is reserved for
 * fiction, so anything in it is test data by definition; seeded tasks go too.
 */
export async function purgeDemoData(): Promise<{
  people: number; workers: number; orders: number; offers: number;
}> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: fake } = await client.query(
      `SELECT id FROM people WHERE phone LIKE '+1412555%'`,
    );
    const ids = fake.map((r) => r.id);

    let workers = 0;
    let offers = 0;
    let orders = 0;

    if (ids.length) {
      offers += (
        await client.query(
          `DELETE FROM job_offers
            WHERE person_id = ANY($1::uuid[])
               OR order_id IN (SELECT id FROM orders WHERE person_id = ANY($1::uuid[]))`,
          [ids],
        )
      ).rowCount ?? 0;
      await client.query(`DELETE FROM agent_handoffs WHERE person_id = ANY($1::uuid[])`, [ids]);
      orders += (
        await client.query(`DELETE FROM orders WHERE person_id = ANY($1::uuid[])`, [ids])
      ).rowCount ?? 0;
      workers += (
        await client.query(`DELETE FROM worker_profiles WHERE person_id = ANY($1::uuid[])`, [ids])
      ).rowCount ?? 0;
      await client.query(
        `DELETE FROM call_notes WHERE call_id IN
           (SELECT id FROM calls WHERE person_id = ANY($1::uuid[]))`,
        [ids],
      );
      await client.query(`DELETE FROM calls WHERE person_id = ANY($1::uuid[])`, [ids]);
      // accepted_by has no ON DELETE rule, so it pins the person row. Release
      // it first or the delete below fails and leaves orphans behind.
      await client.query(
        `UPDATE orders SET accepted_by = NULL WHERE accepted_by = ANY($1::uuid[])`,
        [ids],
      );
      await client.query(`DELETE FROM people WHERE id = ANY($1::uuid[])`, [ids]);
    }

    orders += (await client.query(`DELETE FROM orders WHERE source = 'seed'`)).rowCount ?? 0;
    await client.query("COMMIT");
    return { people: ids.length, workers, orders, offers };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Take one person out of the worker pool entirely. */
export async function removeWorker(phone: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM worker_profiles WHERE phone = $1`, [
    normalizePhone(phone),
  ]);
  return (rowCount ?? 0) > 0;
}

/**
 * Fill the marketplace with a realistic CMU pool. Idempotent: workers upsert on
 * phone, and tasks are only inserted once.
 */
export async function seedDemoData(): Promise<{ workers: number; tasks: number }> {
  let workers = 0;
  for (const w of DEMO_WORKERS) {
    const person = await upsertPerson(w.phone, w.name);
    await pool.query(
      `INSERT INTO worker_profiles (person_id, phone, is_available, blurb, categories, min_price_usd, updated_at)
       VALUES ($1,$2,true,$3,$4::text[],$5, now())
       ON CONFLICT (person_id) DO UPDATE
         SET is_available = true, blurb = EXCLUDED.blurb, categories = EXCLUDED.categories,
             min_price_usd = EXCLUDED.min_price_usd, updated_at = now()`,
      [person.id, w.phone, w.blurb, w.categories, w.min],
    );
    workers++;
  }

  let tasks = 0;
  for (const t of DEMO_TASKS) {
    const person = await upsertPerson(t.phone);
    const existing = await pool.query(
      `SELECT 1 FROM orders WHERE person_id = $1 AND title = $2 LIMIT 1`,
      [person.id, t.title],
    );
    if (existing.rowCount) continue;
    await pool.query(
      `INSERT INTO orders (person_id, source, title, details, category,
                           pickup_location, dropoff_location, budget_usd, urgency)
       VALUES ($1,'seed',$2,$3,$4,$5,$6,$7,$8)`,
      [
        person.id, t.title, t.details, t.category,
        t.pickup || null, t.dropoff || null, t.budget, t.urgency,
      ],
    );
    tasks++;
  }
  return { workers, tasks };
}
