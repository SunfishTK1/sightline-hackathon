import { pool, normalizePhone, upsertPerson } from "./db.js";
import { payForTask, type Settlement } from "./pay.js";
import { getWallet } from "./wallet.js";
import { RAILCOINS_PER_SOL } from "./pay.js";

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
        AND o.ethics_verdict IS DISTINCT FROM 'BLOCK'
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
      RETURNING id, order_id, person_id, phone, offered_usd`,
    [offerId, accepted ? "accepted" : "declined", guard],
  );
  const offer = rows[0];
  if (!offer) return { status: "unchanged", error: "That offer is not open for this person." };

  if (!accepted) {
    // A decline must never resurrect a task that was blocked out from under
    // it - blindly reopening to 'submitted' regardless of ethics_verdict is
    // exactly how a BLOCK verdict got silently bypassed before: the order
    // went back into matching, was accepted, and completed with nobody ever
    // re-checking it. Blocked stays blocked.
    await pool.query(
      `UPDATE orders
          SET status = CASE WHEN ethics_verdict = 'BLOCK' THEN 'blocked' ELSE 'submitted' END,
              updated_at = now()
        WHERE id = $1
          AND NOT EXISTS (
            SELECT 1 FROM job_offers
             WHERE order_id = $1 AND id <> $2 AND status IN ('offered', 'countered', 'accepted')
          )`,
      [offer.order_id, offer.id],
    );
    return { status: "declined", order_id: offer.order_id };
  }

  const order = await pool.query(
    `UPDATE orders
        SET status = 'accepted', accepted_by = $2, accepted_at = now(), updated_at = now(),
            -- $3::numeric, or Postgres infers integer from the literal 0 and
            -- an offered price of "200.00" fails to parse - which silently
            -- broke accepting any offer whose price was not a whole number.
            budget_usd = COALESCE(NULLIF($3::numeric, 0), budget_usd)
      WHERE id = $1
        AND accepted_by IS NULL
        AND status IN ('submitted', 'offered')
      RETURNING id, title, person_id`,
    [offer.order_id, offer.person_id, offer.offered_usd],
  );
  if (!order.rows[0]) {
    await pool.query(
      `UPDATE job_offers SET status = 'cancelled', responded_at = now() WHERE id = $1`,
      [offer.id],
    );
    return { status: "unchanged", error: "That task is no longer open." };
  }
  // Nobody else is still on the hook for this one — including pending counters.
  await pool.query(
    `UPDATE job_offers SET status = 'cancelled', responded_at = now()
      WHERE order_id = $1 AND id <> $2 AND status IN ('offered', 'countered')`,
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
      WHERE id = $1 AND status IN ('submitted', 'offered', 'blocked')
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
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    return { status: "unchanged", error: "price_usd must be greater than zero" };
  }
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
  opts?: { release?: boolean },
): Promise<{ status: string; error?: string }> {
  const { rows } = await pool.query(
    `SELECT j.id, j.order_id, j.person_id, j.phone, j.counter_price_usd, j.offered_usd,
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
    // Timeout / "try next" must release the worker so the order can rematch.
    // A normal requester "no" keeps the original price on the table.
    if (opts?.release) {
      await pool.query(
        `UPDATE job_offers SET status = 'declined', responded_at = now() WHERE id = $1`,
        [offer.id],
      );
      await pool.query(
        `UPDATE orders
            SET status = CASE WHEN ethics_verdict = 'BLOCK' THEN 'blocked' ELSE 'submitted' END,
                updated_at = now()
          WHERE id = $1
            AND NOT EXISTS (
              SELECT 1 FROM job_offers
               WHERE order_id = $1 AND id <> $2 AND status IN ('offered', 'countered', 'accepted')
            )`,
        [offer.order_id, offer.id],
      );
      await pool.query(
        `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
         VALUES ($1,$2,$3,'counter_released',$4::jsonb)`,
        [
          offer.person_id,
          offer.phone,
          offer.order_id,
          JSON.stringify({
            title: offer.title,
            asked_usd: Number(offer.counter_price_usd),
            offer_id: String(offer.id),
          }),
        ],
      );
      return { status: "released" };
    }
    await pool.query(
      `UPDATE job_offers
          SET status = 'offered', countered_at = NULL, counter_price_usd = NULL
        WHERE id = $1`,
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
          still_offered_usd: offer.offered_usd
            ? Number(offer.offered_usd)
            : offer.budget_usd
              ? Number(offer.budget_usd)
              : null,
          offer_id: String(offer.id),
        }),
      ],
    );
    return { status: "declined" };
  }

  const counterPrice = Number(offer.counter_price_usd);
  if (!Number.isFinite(counterPrice) || counterPrice <= 0) {
    return { status: "unchanged", error: "That counter has an invalid price." };
  }
  const accepted = await pool.query(
    `UPDATE orders
        SET budget_usd = NULLIF($2::numeric, 0), status = 'accepted', accepted_by = $3,
            accepted_at = now(), updated_at = now()
      WHERE id = $1
        AND accepted_by IS NULL
        AND status IN ('submitted', 'offered')
      RETURNING id`,
    [offer.order_id, counterPrice, offer.person_id],
  );
  if (!accepted.rows[0]) {
    await pool.query(
      `UPDATE job_offers SET status = 'declined', responded_at = now() WHERE id = $1`,
      [offer.id],
    );
    return { status: "unchanged", error: "That task is no longer open." };
  }
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

// ---------------------------------------------------------------- completion

/** Cut of each job the platform keeps. Zero until someone decides otherwise. */
const PLATFORM_FEE_RATE = 0;

/** The person doing the job says it is finished. The requester still has to agree. */
export async function markTaskDone(
  orderId: string,
  workerPhone: string,
): Promise<{ status: string; error?: string; title?: string }> {
  const e164 = normalizePhone(workerPhone);
  const { rows } = await pool.query(
    `UPDATE orders o
        SET status = 'done_pending', done_marked_at = now(), updated_at = now()
       FROM people w
      WHERE o.id = $1 AND o.status = 'accepted'
        AND w.id = o.accepted_by AND w.phone = $2
      RETURNING o.id, o.title, o.budget_usd, o.person_id`,
    [orderId, e164],
  );
  const order = rows[0];
  if (!order) {
    return { status: "unchanged", error: "That job is not one they are currently doing." };
  }
  const requester = await pool.query(`SELECT id, phone FROM people WHERE id = $1`, [
    order.person_id,
  ]);
  if (requester.rows[0]) {
    await pool.query(
      `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
       VALUES ($1,$2,$3,'task_done_pending',$4::jsonb)`,
      [
        requester.rows[0].id,
        requester.rows[0].phone,
        order.id,
        JSON.stringify({ title: order.title, amount_usd: order.budget_usd }),
      ],
    );
  }
  return { status: "awaiting_confirmation", title: order.title };
}

/**
 * The requester agrees it is done, which is what releases payment. Saying no
 * puts the job back to accepted so it can be sorted out rather than silently
 * failing.
 */
export async function confirmTaskDone(
  orderId: string,
  requesterPhone: string,
  confirmed: boolean,
  note?: string,
): Promise<{ status: string; error?: string; payment?: Record<string, unknown>; settlement?: Settlement | null }> {
  const e164 = normalizePhone(requesterPhone);
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.budget_usd, o.person_id, o.accepted_by, o.status,
            w.phone AS worker_phone, wp.payouts_ready, wp.stripe_account_id
       FROM orders o
       JOIN people p ON p.id = o.person_id
       LEFT JOIN people w ON w.id = o.accepted_by
       LEFT JOIN worker_profiles wp ON wp.person_id = o.accepted_by
      WHERE o.id = $1 AND p.phone = $2 AND o.status = 'done_pending'`,
    [orderId, e164],
  );
  const order = rows[0];
  if (!order) {
    return { status: "unchanged", error: "No task of theirs is waiting to be confirmed." };
  }

  if (!confirmed) {
    const disputed = await pool.query(
      `UPDATE orders SET status = 'accepted', done_marked_at = NULL, updated_at = now()
        WHERE id = $1 AND status = 'done_pending'
        RETURNING id`,
      [order.id],
    );
    if (!disputed.rows[0]) {
      return { status: "unchanged", error: "No task of theirs is waiting to be confirmed." };
    }
    await pool.query(
      `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
       VALUES ($1,$2,$3,'task_disputed',$4::jsonb)`,
      [order.accepted_by, order.worker_phone, order.id,
       JSON.stringify({ title: order.title, note: note ?? null })],
    );
    return { status: "disputed" };
  }

  const amount = Number(order.budget_usd ?? 0);
  const fee = Math.round(amount * PLATFORM_FEE_RATE * 100) / 100;
  const payState = order.payouts_ready ? "ready_to_capture" : "awaiting_payout_setup";
  let paymentRow: Record<string, unknown> | undefined;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const completed = await client.query(
      `UPDATE orders SET status = 'completed', completed_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'done_pending'
        RETURNING id`,
      [order.id],
    );
    if (!completed.rows[0]) {
      await client.query("ROLLBACK");
      return { status: "unchanged", error: "That task is no longer waiting to be confirmed." };
    }

    // Completion and its payment row are one state change. A crash cannot
    // leave a completed task with nothing for retry to claim.
    const payment = await client.query(
      `INSERT INTO payments (order_id, payer_id, payee_id, amount_usd, platform_fee_usd,
                             status, stripe_mode, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (order_id) DO UPDATE SET
         status = CASE
           WHEN payments.solana_signature IS NOT NULL OR payments.status IN ('paid', 'paying')
             THEN payments.status
           ELSE EXCLUDED.status
         END,
         updated_at = now()
       RETURNING id, amount_usd, platform_fee_usd, status`,
      [
        order.id, order.person_id, order.accepted_by, amount, fee, payState,
        process.env.STRIPE_MODE ?? "test",
        order.payouts_ready ? null : "worker has not set up payouts yet",
      ],
    );
    paymentRow = payment.rows[0] as Record<string, unknown> | undefined;
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  // Both sides have now agreed the work is done, which is the only honest
  // moment to move money. A failed settlement does not un-complete the task -
  // it is recorded against the payment so it can be retried or explained.
  let settlement: Settlement | null = null;
  if (order.worker_phone && amount > 0) {
    settlement = await payForTask({
      orderId: order.id,
      payerPhone: e164,
      payeePhone: order.worker_phone,
      amountUsd: amount - fee,
    });
    console.log(
      settlement.settled
        ? `paid ${settlement.railcoins} railcoins for "${order.title}" (${settlement.signature})`
        : `could not settle "${order.title}": ${settlement.reason}`,
    );
  }

  // The requester never heard anything after confirming, so money left their
  // wallet silently. Only sent when it actually moved.
  // Every simulated user asked the same question after being paid: how much do
  // I have now. Read both balances once, after the transfer, so each side can
  // be told theirs rather than being sent off to go and look.
  let payerBalance: number | null = null;
  let payeeBalance: number | null = null;
  if (settlement?.settled) {
    const [payer, payee] = await Promise.all([
      getWallet(e164).catch(() => null),
      getWallet(order.worker_phone).catch(() => null),
    ]);
    payerBalance = payer ? Math.round(payer.balance_sol * RAILCOINS_PER_SOL) : null;
    payeeBalance = payee ? Math.round(payee.balance_sol * RAILCOINS_PER_SOL) : null;

    await pool.query(
      `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
       VALUES ($1,$2,$3,'payment_sent',$4::jsonb)`,
      [
        order.person_id,
        e164,
        order.id,
        JSON.stringify({
          title: order.title,
          railcoins: settlement.railcoins,
          balance: payerBalance,
        }),
      ],
    );
  }

  await pool.query(
    `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
     VALUES ($1,$2,$3,'task_completed',$4::jsonb)`,
    [
      order.accepted_by,
      order.worker_phone,
      order.id,
      JSON.stringify({
        title: order.title,
        amount_usd: amount,
        payouts_ready: Boolean(order.payouts_ready),
        railcoins: settlement?.railcoins ?? null,
        balance: payeeBalance,
        paid: settlement?.settled ?? false,
        settlement_error: settlement && !settlement.settled ? settlement.reason : null,
      }),
    ],
  );
  return { status: "completed", payment: paymentRow, settlement };
}

/**
 * The requester says it arrived, and pays, in one step.
 *
 * The worker must already have marked it done. This keeps an accepted task
 * from being paid accidentally before any work has happened.
 *
 * Both phones come from the order itself rather than the caller, so whoever
 * calls this cannot name a different requester or redirect the payment.
 */
export async function receiveAndPay(orderId: string, requesterPhone?: string) {
  const { rows } = await pool.query(
    `SELECT o.status, p.phone AS requester_phone, w.phone AS worker_phone
       FROM orders o
       JOIN people p ON p.id = o.person_id
       LEFT JOIN people w ON w.id = o.accepted_by
      WHERE o.id = $1`,
    [orderId],
  );
  const order = rows[0];
  if (!order) return { error: "no_such_task" as const };
  if (requesterPhone && normalizePhone(requesterPhone) !== order.requester_phone) {
    return { error: "not_the_requester" as const };
  }
  if (order.status === "completed") {
    const pay = await pool.query<{ solana_signature: string | null; status: string | null }>(
      `SELECT solana_signature, status FROM payments WHERE order_id = $1`,
      [orderId],
    );
    const row = pay.rows[0];
    if (row?.solana_signature || row?.status === "paid") {
      return { error: "already_paid" as const };
    }
    if (!order.worker_phone) return { error: "nobody_has_taken_it" as const };
    const amountRow = await pool.query<{ budget_usd: string | null; platform_fee_usd: string | null }>(
      `SELECT o.budget_usd, p.platform_fee_usd
         FROM orders o
         LEFT JOIN payments p ON p.order_id = o.id
        WHERE o.id = $1`,
      [orderId],
    );
    const amount = Number(amountRow.rows[0]?.budget_usd ?? 0);
    const fee = Number(
      amountRow.rows[0]?.platform_fee_usd ?? Math.round(amount * PLATFORM_FEE_RATE * 100) / 100,
    );
    if (!(amount > 0)) return { error: "already_paid" as const };
    const settlement = await payForTask({
      orderId,
      payerPhone: order.requester_phone,
      payeePhone: order.worker_phone,
      amountUsd: amount - fee,
    });
    return { status: "completed", settlement };
  }
  if (order.status !== "done_pending") return { error: "not_ready_to_pay" as const };
  if (!order.worker_phone) return { error: "nobody_has_taken_it" as const };
  return confirmTaskDone(orderId, order.requester_phone, true);
}

/** Jobs marked done that the requester has not answered yet. */
export async function listAwaitingConfirmation(requesterPhone: string) {
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.budget_usd, o.done_marked_at, w.phone AS worker_phone
       FROM orders o
       JOIN people p ON p.id = o.person_id
       LEFT JOIN people w ON w.id = o.accepted_by
      WHERE o.status = 'done_pending' AND p.phone = $1
      ORDER BY o.done_marked_at`,
    [normalizePhone(requesterPhone)],
  );
  return rows;
}

/** Jobs this person is doing right now. */
export async function listJobsInProgress(workerPhone: string) {
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.budget_usd, o.status, o.accepted_at
       FROM orders o
       JOIN people w ON w.id = o.accepted_by
      WHERE w.phone = $1 AND o.status IN ('accepted', 'done_pending')
      ORDER BY o.accepted_at DESC`,
    [normalizePhone(workerPhone)],
  );
  return rows;
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
        offer_id: String(offer.id),
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
      RETURNING q.id, q.order_id, q.offer_id, q.asker_phone, q.question, o.title`,
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
      JSON.stringify({
        title: q.title,
        question: q.question,
        answer,
        offer_id: q.offer_id != null ? String(q.offer_id) : undefined,
      }),
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
    `SELECT j.id, j.phone, j.outreach_sent_at, j.offered_usd, j.counter_rounds, o.id AS order_id,
            o.title, o.budget_usd,
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
            j.offered_usd, j.counter_rounds, o.id AS order_id, o.title, o.budget_usd AS order_budget_usd, p.phone AS requester_phone
       FROM job_offers j
       JOIN orders o ON o.id = j.order_id
       JOIN people p ON p.id = o.person_id
      WHERE j.status = 'countered'
      ORDER BY j.countered_at
      LIMIT 20`,
  );
  return { offers: offers.rows, counters: counters.rows };
}

/**
 * Who is worth phoning, and why. A call is more intrusive than a text, so this
 * only lists things a text has already failed to move: an offer sitting
 * unanswered, a counter nobody has decided, a question blocking a job.
 *
 * `stale_minutes` sets how long counts as stuck.
 */
export async function callWorthy(staleMinutes = 20) {
  const stale = `${Math.max(1, Math.min(staleMinutes, 1440))} minutes`;

  const offers = await pool.query(
    `SELECT j.id AS offer_id, j.phone, p.display_name, o.id AS order_id, o.title, o.budget_usd, j.outreach_sent_at,
            EXTRACT(EPOCH FROM (now() - j.outreach_sent_at))/60 AS minutes_waiting
       FROM job_offers j
       JOIN orders o ON o.id = j.order_id
       LEFT JOIN people p ON p.phone = j.phone
      WHERE j.status = 'offered' AND j.outreach_sent_at IS NOT NULL
        AND j.outreach_sent_at < now() - $1::interval
      ORDER BY j.outreach_sent_at
      LIMIT 10`,
    [stale],
  );

  const counters = await pool.query(
    `SELECT j.id AS offer_id, p.phone, p.display_name, o.id AS order_id, o.title, j.counter_price_usd, o.budget_usd,
            EXTRACT(EPOCH FROM (now() - j.countered_at))/60 AS minutes_waiting
       FROM job_offers j
       JOIN orders o ON o.id = j.order_id
       JOIN people p ON p.id = o.person_id
      WHERE j.status = 'countered' AND j.countered_at < now() - $1::interval
      ORDER BY j.countered_at
      LIMIT 10`,
    [stale],
  );

  const questions = await pool.query(
    `SELECT q.id AS question_id, p.phone, p.display_name, o.id AS order_id, o.title, q.question,
            EXTRACT(EPOCH FROM (now() - q.asked_at))/60 AS minutes_waiting
       FROM job_questions q
       JOIN orders o ON o.id = q.order_id
       JOIN people p ON p.id = o.person_id
      WHERE q.answered_at IS NULL AND q.asked_at < now() - $1::interval
      ORDER BY q.asked_at
      LIMIT 10`,
    [stale],
  );

  const round = (n: unknown) => Math.round(Number(n));
  return [
    ...offers.rows.map((r) => ({
      phone: r.phone,
      name: r.display_name,
      offer_id: String(r.offer_id),
      order_id: r.order_id ? String(r.order_id) : undefined,
      reason: "offer_unanswered",
      minutes_waiting: round(r.minutes_waiting),
      about: r.title,
      calling_about: `a job they were offered: ${r.title}${r.budget_usd ? ` for $${r.budget_usd}` : ""}`,
    })),
    ...counters.rows.map((r) => ({
      phone: r.phone,
      name: r.display_name,
      offer_id: String(r.offer_id),
      order_id: r.order_id ? String(r.order_id) : undefined,
      reason: "counter_undecided",
      minutes_waiting: round(r.minutes_waiting),
      about: r.title,
      calling_about: `someone will do "${r.title}" for $${r.counter_price_usd} instead of $${r.budget_usd}, and it needs a yes or no`,
    })),
    ...questions.rows.map((r) => ({
      phone: r.phone,
      name: r.display_name,
      question_id: String(r.question_id),
      order_id: r.order_id ? String(r.order_id) : undefined,
      reason: "question_unanswered",
      minutes_waiting: round(r.minutes_waiting),
      about: r.title,
      calling_about: `a question about "${r.title}" is blocking someone: ${r.question}`,
    })),
  ].sort((a, b) => b.minutes_waiting - a.minutes_waiting);
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

const NO_MATCH_PARK_AFTER = 3;

/**
 * The matcher looked and picked nobody. Count the miss; after a few tries,
 * park the order and tell the requester instead of retrying every 10s.
 */
export async function recordNoMatch(orderId: string) {
  const { rows } = await pool.query(
    `UPDATE orders
        SET match_attempts = match_attempts + 1,
            status = CASE
              WHEN match_attempts + 1 >= $2 AND status IN ('submitted', 'offered')
              THEN 'no_takers'
              ELSE status
            END,
            updated_at = now()
      WHERE id = $1 AND status IN ('submitted', 'offered')
      RETURNING id, title, person_id, match_attempts, status`,
    [orderId, NO_MATCH_PARK_AFTER],
  );
  const order = rows[0];
  if (!order) return { counted: false };
  const parked = order.status === "no_takers";
  if (parked) {
    const requester = await pool.query(`SELECT id, phone FROM people WHERE id = $1`, [
      order.person_id,
    ]);
    if (requester.rows[0]) {
      await pool.query(
        `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
         VALUES ($1,$2,$3,'no_takers',$4::jsonb)`,
        [
          requester.rows[0].id,
          requester.rows[0].phone,
          order.id,
          JSON.stringify({ title: order.title }),
        ],
      );
    }
  }
  return { counted: true, parked, attempts: order.match_attempts };
}

/**
 * Call a task off. Anyone currently holding or negotiating the offer is told,
 * rather than left waiting on a job that no longer exists.
 *
 * A completed task cannot be cancelled - that money has already moved.
 * An accepted or done-pending job is already theirs; cancel is too late.
 */
export async function cancelOrder(orderId: string, reason?: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE orders SET status = 'cancelled', updated_at = now()
        WHERE id = $1 AND status NOT IN ('completed', 'cancelled', 'done_pending', 'accepted')
        RETURNING id, title, person_id`,
      [orderId],
    );
    const order = rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return { error: "not_cancellable" as const };
    }

    const open = await client.query(
      `UPDATE job_offers SET status = 'cancelled', responded_at = now()
        WHERE order_id = $1 AND status IN ('offered', 'accepted', 'countered')
        RETURNING phone, person_id`,
      [orderId],
    );
    for (const holder of open.rows) {
      await client.query(
        `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
         VALUES ($1,$2,$3,'task_cancelled',$4::jsonb)`,
        [
          holder.person_id,
          holder.phone,
          orderId,
          JSON.stringify({ title: order.title, reason: reason ?? null }),
        ],
      );
    }
    await client.query("COMMIT");
    return { cancelled: order.id, title: order.title, told: open.rows.length };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Pull a task that should never have been open. Unlike a cancellation this
 * records why, and it has to reach anyone already holding the offer: a task
 * that is blocked after it was put to someone leaves a worker expecting a job
 * that is not going to happen.
 */
export async function blockOrder(orderId: string, reason: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE orders
          SET status = 'blocked', ethics_verdict = 'BLOCK', ethics_reason = $2, updated_at = now()
        WHERE id = $1 AND status NOT IN ('completed', 'cancelled', 'done_pending', 'accepted')
        RETURNING id, title`,
      [orderId, reason],
    );
    const order = rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return { error: "not_blockable" as const };
    }

    const open = await client.query(
      `UPDATE job_offers SET status = 'cancelled', responded_at = now()
        WHERE order_id = $1 AND status IN ('offered', 'accepted', 'countered')
        RETURNING phone, person_id`,
      [orderId],
    );
    for (const holder of open.rows) {
      await client.query(
        `INSERT INTO agent_handoffs (person_id, phone, order_id, kind, payload)
         VALUES ($1,$2,$3,'task_cancelled',$4::jsonb)`,
        [
          holder.person_id,
          holder.phone,
          orderId,
          JSON.stringify({ title: order.title, reason }),
        ],
      );
    }
    await client.query("COMMIT");
    return { blocked: order.id, title: order.title, told: open.rows.length };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Someone says they will do a task nobody offered them.
 *
 * The film broadcast tells every active tasker "text me if you'll take it",
 * which is a call to action with nothing behind it unless they can actually
 * take it. This creates the offer and accepts it in one step - the person
 * volunteered, so there is nothing left to ask them.
 */
export async function claimTask(orderId: string, workerPhone: string) {
  const e164 = normalizePhone(workerPhone);
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.status, o.budget_usd, o.person_id, p.phone AS requester_phone
       FROM orders o JOIN people p ON p.id = o.person_id
      WHERE o.id = $1`,
    [orderId],
  );
  const order = rows[0];
  if (!order) return { error: "no_such_task" as const };
  if (order.requester_phone === e164) return { error: "thats_your_own_task" as const };
  if (!["submitted", "offered", "no_takers"].includes(order.status)) {
    return { error: "not_available" as const, status: order.status };
  }

  const worker = await upsertPerson(e164);
  // Someone actively volunteering beats someone sitting on an unanswered ask.
  // Without this the claim fails on the order's own pending offer and the
  // volunteer is told no, which is how Daphne was refused a job she offered
  // to do twice.
  await pool.query(
    `UPDATE job_offers SET status = 'cancelled', responded_at = now()
      WHERE order_id = $1 AND phone <> $2 AND status IN ('offered', 'countered')`,
    [order.id, e164],
  );
  // Reuse their existing offer if one is already open to them; otherwise make
  // one so there is a row to accept and to settle against later.
  const { rows: offerRows } = await pool.query(
    `INSERT INTO job_offers (order_id, person_id, phone, status, reason, offered_usd, outreach_sent_at)
     VALUES ($1,$2,$3,'offered','They volunteered for it.',$4, now())
     ON CONFLICT (order_id, phone) DO UPDATE
       SET status = CASE WHEN job_offers.status IN ('declined','cancelled','dropped')
                         THEN 'offered' ELSE job_offers.status END
     RETURNING id, status`,
    [order.id, worker.id, e164, order.budget_usd ?? null],
  );
  const offer = offerRows[0];
  if (!offer) return { error: "could_not_offer" as const };
  if (offer.status === "accepted") {
    // Their offer says accepted but the task may not have caught up - that
    // split is exactly what a non-transactional accept leaves behind. Finish
    // the job rather than reporting success on half of it.
    if (order.status !== "accepted") {
      await pool.query(
        `UPDATE orders
            SET status = 'accepted', accepted_by = $2, accepted_at = COALESCE(accepted_at, now()),
                updated_at = now()
          WHERE id = $1 AND status IN ('submitted', 'offered', 'no_takers')`,
        [order.id, worker.id],
      );
    }
    return { status: "already_yours" as const, order_id: order.id, title: order.title };
  }

  const taken = await resolveOffer(offer.id, true, e164);
  if (taken.error) return { error: "not_available" as const, detail: taken.error };
  return { status: "accepted" as const, order_id: order.id, title: order.title, offer_id: offer.id };
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
