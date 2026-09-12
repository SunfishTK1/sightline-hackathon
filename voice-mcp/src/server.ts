import "dotenv/config";
import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ensureSchema, pool, normalizePhone, upsertPerson } from "./db.js";
import {
  resolveOffer, seedDemoData, purgeDemoData, removeWorker,
  counterOffer, respondToCounter, listOpenCounters, pendingNegotiation,
  askAboutJob, answerJobQuestion, listOpenQuestions, listMyQuestions, reassignOrder,
  callWorthy, markTaskDone, confirmTaskDone, listAwaitingConfirmation, listJobsInProgress,
  cancelOrder, blockOrder, receiveAndPay, claimTask, recordNoMatch,
} from "./marketplace.js";
import { tools, toolsByName } from "./tools.js";
import { ensureWallet, getWallet } from "./wallet.js";
import { saveStyle } from "./style.js";
import { registerSignup, verifySignup, signupStatus, setAvailability } from "./signup.js";
import { chargeToTreasury } from "./pay.js";
import { reviewTask } from "./ethics.js";
import { createWalletLink, resolveWalletLink, createWalletForLink } from "./walletlink.js";

const PORT = Number(process.env.PORT || 3010);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN; // unset = open (demo only)

const app = express();
// Generated illustrations arrive base64-encoded and run past a megabyte, so
// the limit has to clear the relay's own 16MB attachment ceiling.
app.use(express.json({ limit: "25mb" }));

// Every request is logged: without this there is no way to tell whether a
// voice agent ever reached us, or what it asked for.
app.use((req, _res, next) => {
  if (req.path !== "/health") {
    const body = req.body as any;
    const detail = req.path.startsWith("/v1/tools/")
      ? ""
      : body?.method === "tools/call"
        ? ` tools/call ${body?.params?.name ?? "?"}`
        : body?.method
          ? ` ${body.method}`
          : "";
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}${detail}`);
  }
  next();
});

function authorized(req: express.Request): boolean {
  if (!AUTH_TOKEN) return true;
  const header = req.header("authorization") || "";
  return header === `Bearer ${AUTH_TOKEN}` || req.header("x-api-key") === AUTH_TOKEN;
}

app.use((req, res, next) => {
  if (req.path === "/health" || authorized(req)) return next();
  res.status(401).json({ error: "unauthorized" });
});

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, tools: tools.map((t) => t.name) });
  } catch (err) {
    res.status(503).json({ ok: false, error: (err as Error).message });
  }
});

/** Build a server per request: stateless, so a dropped call leaks nothing. */
function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "gotchu-voice", version: "0.1.0" });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.shape },
      async (input: any) => {
        try {
          const result = await tool.handler(input);
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    );
  }
  return server;
}

// Mounted at both /mcp and / - clients are often configured with the bare
// origin, and a 404 there just looks like the server is down.
async function handleMcp(req: express.Request, res: express.Response) {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("mcp error", err);
    if (!res.headersSent) res.status(500).json({ error: (err as Error).message });
  }
}

app.post("/mcp", handleMcp);
app.post("/", handleMcp);

// Stateless transport: these verbs carry no session to resume.
app.get("/mcp", (_req, res) => {
  res.status(405).json({ error: "method_not_allowed" });
});
app.delete("/mcp", (_req, res) => {
  res.status(405).json({ error: "method_not_allowed" });
});
app.get("/", (_req, res) => {
  res.json({
    service: "gotchu-voice-mcp",
    mcp_endpoint: "/mcp",
    rest_endpoint: "/v1/tools/{name}",
    tools: tools.map((t) => t.name),
  });
});

/**
 * REST mirror of the same handlers, for voice platforms that can call a webhook
 * but not an MCP server.
 */
app.post("/v1/tools/:name", async (req, res) => {
  const tool = toolsByName.get(req.params.name);
  if (!tool) return res.status(404).json({ error: `no tool ${req.params.name}` });
  const parsed = z.object(tool.shape).safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", issues: parsed.error.issues });
  }
  try {
    res.json({ ok: true, data: await tool.handler(parsed.data) });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// -------------------------------------------------------------------- wallets

/** Create (if needed) and fund this person's devnet wallet. Idempotent. */
app.post("/v1/wallets/ensure", async (req, res) => {
  const { phone } = req.body ?? {};
  if (!phone) return res.status(400).json({ ok: false, error: "phone is required" });
  try {
    res.json({ ok: true, data: await ensureWallet(String(phone)) });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/** Mint a link the agent can text so someone can open their own wallet. */
app.post("/v1/wallet-links", async (req, res) => {
  const { phone } = req.body ?? {};
  if (!phone) return res.status(400).json({ ok: false, error: "phone is required" });
  try {
    res.json({ ok: true, data: await createWalletLink(String(phone)) });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

/** What the page shows. An expired or unknown token is simply not found. */
app.get("/v1/wallet-links/:token", async (req, res) => {
  const found = await resolveWalletLink(req.params.token);
  if (!found) return res.status(404).json({ ok: false, error: "link_expired" });
  res.json({ ok: true, data: found });
});

/** The page's one action: make me a wallet. */
app.post("/v1/wallet-links/:token/wallet", async (req, res) => {
  try {
    const wallet = await createWalletForLink(req.params.token);
    if (!wallet) return res.status(404).json({ ok: false, error: "link_expired" });
    res.json({ ok: true, data: wallet });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/** This person's wallet and its live devnet balance, or null if they have none yet. */
app.get("/v1/wallets/:phone", async (req, res) => {
  try {
    res.json({ ok: true, data: await getWallet(req.params.phone) });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------- style

/**
 * The personal agent's own learned read on how this person likes to be
 * talked to. Written from their message history, never from anything they
 * typed into a form - that's what the ToS training clause covers.
 */
app.post("/v1/style/save", async (req, res) => {
  const { phone, summary, style_tag, embedding } = req.body ?? {};
  if (!phone || !summary || !style_tag || !Array.isArray(embedding)) {
    return res.status(400).json({
      ok: false,
      error: "phone, summary, style_tag, and embedding (array) are required",
    });
  }
  try {
    await saveStyle(String(phone), String(summary), String(style_tag), embedding);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ---------------------------------------------------------------- marketplace

/** Who is in the worker pool, and how they are doing. */
app.get("/v1/workers", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT w.phone, w.is_available, w.blurb, w.categories, w.min_price_usd, w.updated_at,
            p.display_name,
            (SELECT count(*) FROM job_offers j
              WHERE j.phone = w.phone AND j.status = 'offered')::int AS open_offers,
            (SELECT count(*) FROM job_offers j
              WHERE j.phone = w.phone AND j.status = 'accepted')::int AS jobs_accepted,
            (SELECT count(*) FROM job_offers j
              WHERE j.phone = w.phone AND j.status = 'declined')::int AS jobs_declined
       FROM worker_profiles w
       LEFT JOIN people p ON p.id = w.person_id
      ORDER BY w.updated_at DESC
      LIMIT $1`,
    [Math.min(Number(req.query.limit) || 25, 100)],
  );
  res.json({ ok: true, data: rows });
});

/** Everyone who can actually be sent something right now. */
app.get("/v1/workers/active", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT w.phone, p.display_name
       FROM worker_profiles w
       JOIN people p ON p.id = w.person_id
      WHERE w.is_available AND p.phone_verified
      ORDER BY w.updated_at DESC`,
  );
  res.json({ ok: true, data: rows });
});

/**
 * Tasks a volunteer could still take. Deliberately wider than /v1/orders/open,
 * which the matcher uses and which hides anything already put to one person:
 * the film broadcast advertises a task to every active tasker, so somebody
 * answering it has to be able to find it even while another person is sitting
 * on an unanswered offer.
 */
app.get("/v1/orders/claimable", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.details, o.category, o.pickup_location, o.dropoff_location,
            o.deadline_at, o.budget_usd, o.urgency, o.created_at, p.phone AS requester_phone
       FROM orders o
       JOIN people p ON p.id = o.person_id
      WHERE o.status IN ('submitted', 'offered', 'no_takers')
      ORDER BY o.created_at DESC
      LIMIT 20`,
  );
  res.json({ ok: true, data: rows });
});

/** Orders still looking for someone, with nobody currently on the hook. */
app.get("/v1/orders/open", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.details, o.category, o.pickup_location, o.dropoff_location,
            o.deadline_at, o.budget_usd, o.urgency, o.created_at, p.phone AS requester_phone
       FROM orders o
       JOIN people p ON p.id = o.person_id
      WHERE o.status IN ('submitted', 'offered')
        AND o.ethics_verdict IS DISTINCT FROM 'BLOCK'
        AND NOT EXISTS (
          SELECT 1 FROM job_offers j
           WHERE j.order_id = o.id AND j.status IN ('offered', 'countered', 'accepted'))
      ORDER BY o.created_at
      LIMIT 10`,
  );
  res.json({ ok: true, data: rows });
});

/** Who could plausibly take this order: available, and not the requester. */
app.get("/v1/orders/:orderId/candidates", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT w.phone, w.blurb, w.categories, w.min_price_usd
       FROM worker_profiles w
       JOIN people wp ON wp.id = w.person_id
       JOIN orders o ON o.id = $1
      WHERE w.is_available
        AND wp.phone_verified
        -- Someone who signed up on the web claimed a specific CMU identity, so
        -- that claim has to be proven before they can be offered work. Anyone
        -- who only ever arrived by phone has no email to verify and is
        -- unaffected.
        AND (wp.email IS NULL OR COALESCE((wp.doc->>'emailVerified')::boolean, false))
        AND w.person_id <> o.person_id
        AND NOT EXISTS (
          SELECT 1 FROM job_offers j
           WHERE j.order_id = o.id AND j.phone = w.phone
             AND j.status IN ('offered', 'countered', 'accepted'))
      LIMIT 25`,
    [req.params.orderId],
  );
  res.json({ ok: true, data: rows });
});

/** The marketplace agent decided this person is eligible: put it to them. */
app.post("/v1/offers", async (req, res) => {
  const { order_id, phone, reason, offered_usd, travel_note } = req.body ?? {};
  if (!order_id || !phone) {
    return res.status(400).json({ ok: false, error: "order_id and phone are required" });
  }
  const e164 = normalizePhone(String(phone));
  const person = await upsertPerson(e164);
  const offered = offered_usd != null && Number(offered_usd) > 0 ? Number(offered_usd) : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const open = await client.query(
      `SELECT id FROM orders
        WHERE id = $1
          AND status IN ('submitted', 'offered')
          AND ethics_verdict IS DISTINCT FROM 'BLOCK'
        FOR UPDATE`,
      [order_id],
    );
    if (!open.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, error: "order_not_open" });
    }
    const held = await client.query(
      `SELECT id FROM job_offers
        WHERE order_id = $1
          AND status IN ('offered', 'countered', 'accepted')
          AND phone IS DISTINCT FROM $2
        LIMIT 1`,
      [order_id, e164],
    );
    if (held.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, error: "already_offered" });
    }
    const { rows } = await client.query(
      `INSERT INTO job_offers (order_id, person_id, phone, reason, offered_usd, travel_note)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (order_id, phone) DO UPDATE
         SET reason = COALESCE(EXCLUDED.reason, job_offers.reason),
             offered_usd = COALESCE(EXCLUDED.offered_usd, job_offers.offered_usd),
             travel_note = COALESCE(EXCLUDED.travel_note, job_offers.travel_note),
             status = CASE
               WHEN job_offers.status IN ('accepted', 'countered') THEN job_offers.status
               ELSE 'offered'
             END,
             outreach_sent_at = CASE
               WHEN job_offers.status IN ('accepted', 'countered') THEN job_offers.outreach_sent_at
               ELSE NULL
             END,
             responded_at = CASE
               WHEN job_offers.status IN ('accepted', 'countered') THEN job_offers.responded_at
               ELSE NULL
             END,
             counter_rounds = CASE
               WHEN job_offers.status IN ('accepted', 'countered') THEN job_offers.counter_rounds
               ELSE 0
             END,
             counter_price_usd = CASE
               WHEN job_offers.status IN ('accepted', 'countered') THEN job_offers.counter_price_usd
               ELSE NULL
             END,
             countered_at = CASE
               WHEN job_offers.status IN ('accepted', 'countered') THEN job_offers.countered_at
               ELSE NULL
             END
       RETURNING id, order_id, phone, status, offered_usd, travel_note`,
      [order_id, person.id, e164, reason ?? null, offered, travel_note ?? null],
    );
    await client.query(
      `UPDATE orders SET status = 'offered', updated_at = now()
        WHERE id = $1 AND status IN ('submitted', 'offered')`,
      [order_id],
    );
    await client.query("COMMIT");
    res.json({ ok: true, data: rows[0] ?? null });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    res.status(500).json({ ok: false, error: (err as Error).message });
  } finally {
    client.release();
  }
});

/** Every recent offer, including ones whose outreach has not gone out yet. */
app.get("/v1/offers", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT j.id, j.phone, j.status, j.reason, j.outreach_sent_at, j.responded_at,
            j.created_at, j.offered_usd, o.title, o.budget_usd
       FROM job_offers j
       JOIN orders o ON o.id = j.order_id
      ORDER BY j.created_at DESC
      LIMIT $1`,
    [Math.min(Number(req.query.limit) || 20, 100)],
  );
  res.json({ ok: true, data: rows });
});

/**
 * Update the market offer on a live offer. The broker sets this price; the
 * requester's budget_usd is a different column and is never overwritten.
 */
app.post("/v1/offers/:id/price", async (req, res) => {
  const offered = Number(req.body?.offered_usd);
  if (!Number.isFinite(offered) || offered <= 0) {
    return res.status(400).json({ ok: false, error: "offered_usd must be greater than zero" });
  }
  const { rows } = await pool.query(
    `UPDATE job_offers SET offered_usd = $2 WHERE id = $1 AND status IN ('offered','countered')
      RETURNING id, offered_usd, status`,
    [req.params.id, offered],
  );
  if (!rows[0]) return res.status(409).json({ ok: false, error: "offer is not live" });
  res.json({ ok: true, data: rows[0] });
});

/** Offers that still need the outreach text sent. */
app.get("/v1/offers/outreach", async (_req, res) => {
  const { rows } = await pool.query(
    // The requester's phone rides along because outreach starts the film when
    // it holds an offer, and a film without it cannot look up whether they
    // agreed to appear in it.
    `SELECT j.id, j.phone, j.reason, j.offered_usd, j.travel_note, j.created_at, o.id AS order_id,
            o.title, o.details, o.budget_usd, o.deadline_at,
            o.pickup_location, o.dropoff_location, o.category,
            p.phone AS requester_phone
       FROM job_offers j
       JOIN orders o ON o.id = j.order_id
       LEFT JOIN people p ON p.id = o.person_id
      WHERE j.outreach_sent_at IS NULL AND j.status = 'offered'
      ORDER BY j.created_at
      LIMIT 10`,
  );
  res.json({ ok: true, data: rows });
});

app.post("/v1/offers/:id/sent", async (req, res) => {
  await pool.query(`UPDATE job_offers SET outreach_sent_at = now() WHERE id = $1`, [
    req.params.id,
  ]);
  res.json({ ok: true });
});

/**
 * Every job this person is currently being asked about. One person can hold
 * several open offers at once, so this is a list.
 */
app.get("/v1/offers/open", async (req, res) => {
  const phone = normalizePhone(String(req.query.phone ?? ""));
  const { rows } = await pool.query(
    `SELECT j.id, j.reason, j.offered_usd, o.id AS order_id, o.title, o.details, o.budget_usd,
            o.deadline_at, o.pickup_location, o.dropoff_location
       FROM job_offers j
       JOIN orders o ON o.id = j.order_id
      WHERE j.phone = $1 AND j.status = 'offered' AND j.outreach_sent_at IS NOT NULL
      ORDER BY j.created_at
      LIMIT 10`,
    [phone],
  );
  res.json({ ok: true, data: rows });
});

/** Yes or no. On yes, the order is theirs and the requester gets told. */
app.post("/v1/offers/:id/respond", async (req, res) => {
  const result = await resolveOffer(
    req.params.id,
    Boolean(req.body?.accepted),
    req.body?.phone ? String(req.body.phone) : undefined,
  );
  if (result.error) return res.status(409).json({ ok: false, error: result.error });
  res.json({ ok: true, data: result });
});

/** Delete the fictional demo pool and anything it created. */
app.post("/v1/dev/purge-demo", async (_req, res) => {
  try {
    const counts = await purgeDemoData();
    console.log(`purged demo data: ${JSON.stringify(counts)}`);
    res.json({ ok: true, data: counts });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.delete("/v1/workers/:phone", async (req, res) => {
  const removed = await removeWorker(req.params.phone);
  res.json({ ok: true, data: { removed } });
});

/** Fill the marketplace with a realistic CMU pool. Safe to run more than once. */
app.post("/v1/dev/seed", async (_req, res) => {
  try {
    const counts = await seedDemoData();
    console.log(`seeded ${counts.workers} workers, ${counts.tasks} tasks`);
    res.json({ ok: true, data: counts });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/**
 * Live tasks with no clip yet. The film is a pitch, not a record: it goes to
 * the people being asked to take the job, so it is made while the task is
 * still looking for someone.
 */
app.get("/v1/orders/needing-video", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.details, o.category, o.pickup_location, o.dropoff_location,
            o.budget_usd, o.deadline_at, o.created_at, p.phone AS requester_phone
       FROM orders o
       JOIN people p ON p.id = o.person_id
       LEFT JOIN order_videos v ON v.order_id = o.id
      WHERE v.order_id IS NULL
        AND o.film_requested_at IS NOT NULL
        AND o.film_paid_signature IS NOT NULL
        AND o.status IN ('submitted', 'offered', 'accepted', 'done_pending')
        AND o.ethics_verdict IS DISTINCT FROM 'BLOCK'
      ORDER BY o.created_at DESC
      LIMIT 3`,
  );
  res.json({ ok: true, data: rows });
});

/** Who currently holds an open offer on a task - the audience for its film. */
app.get("/v1/orders/:id/offer-holders", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT phone, status FROM job_offers
      WHERE order_id = $1 AND status IN ('offered', 'countered')`,
    [req.params.id],
  );
  res.json({ ok: true, data: rows });
});

app.post("/v1/orders/:id/video", async (req, res) => {
  const { mp4_base64, storage_key, bytes: reportedBytes, prompt, seconds } = req.body ?? {};
  if (!mp4_base64 && !storage_key) {
    return res.status(400).json({ ok: false, error: "storage_key or mp4_base64 is required" });
  }

  // Preferred: the bytes are already in the bucket and only the key is kept.
  // The inline form stays for anything not going through storage.
  const bytes = storage_key
    ? Number(reportedBytes) || null
    : Buffer.from(mp4_base64, "base64").length;

  await pool.query(
    `INSERT INTO order_videos (order_id, mp4, storage_key, bytes, prompt, seconds)
     VALUES ($1, CASE WHEN $2::text IS NULL THEN NULL ELSE decode($2,'base64') END, $3, $4, $5, $6)
     ON CONFLICT (order_id) DO UPDATE
       SET mp4 = EXCLUDED.mp4, storage_key = EXCLUDED.storage_key, bytes = EXCLUDED.bytes,
           prompt = EXCLUDED.prompt, seconds = EXCLUDED.seconds`,
    [req.params.id, mp4_base64 ?? null, storage_key ?? null, bytes, prompt ?? null, seconds ?? null],
  );
  res.json({ ok: true, data: { order_id: req.params.id, bytes, storage_key: storage_key ?? null } });
});

app.get("/v1/orders/:id/video", async (req, res) => {
  const { rows } = await pool.query(
    // Only inline the bytes for rows that predate object storage; once there is
    // a key, the caller reads the clip from the bucket instead.
    `SELECT storage_key, seconds, delivered_at,
            COALESCE(bytes, octet_length(mp4)) AS bytes,
            CASE WHEN storage_key IS NULL THEN encode(mp4,'base64') END AS mp4_base64
       FROM order_videos WHERE order_id = $1`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ ok: false, error: "no video for that order" });
  res.json({ ok: true, data: rows[0] });
});

/** Clips generated but not yet sent - the relay cannot carry video yet. */
app.get("/v1/videos/pending-delivery", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT v.order_id, v.seconds, COALESCE(v.bytes, octet_length(v.mp4)) AS bytes, v.created_at,
            o.title, p.phone AS requester_phone, w.phone AS worker_phone
       FROM order_videos v
       JOIN orders o ON o.id = v.order_id
       JOIN people p ON p.id = o.person_id
       LEFT JOIN people w ON w.id = o.accepted_by
      WHERE v.delivered_at IS NULL
      ORDER BY v.created_at
      LIMIT 10`,
  );
  res.json({ ok: true, data: rows });
});

app.post("/v1/orders/:id/video/delivered", async (req, res) => {
  await pool.query(
    `UPDATE order_videos SET delivered_at = now() WHERE order_id = $1 AND delivered_at IS NULL`,
    [req.params.id],
  );
  res.json({ ok: true });
});

/** Tasks that still have no illustration. */
app.get("/v1/orders/needing-image", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.details, o.category, o.pickup_location, o.dropoff_location,
            o.budget_usd, o.deadline_at, p.phone AS requester_phone
       FROM orders o
       JOIN people p ON p.id = o.person_id
       LEFT JOIN order_images i ON i.order_id = o.id
      WHERE i.order_id IS NULL
        AND o.status IN ('submitted','offered','accepted')
        AND o.ethics_verdict IS DISTINCT FROM 'BLOCK'
      ORDER BY o.created_at DESC
      LIMIT 5`,
  );
  res.json({ ok: true, data: rows });
});

app.post("/v1/orders/:id/image", async (req, res) => {
  const { png_base64, storage_key, bytes: reportedBytes, prompt } = req.body ?? {};
  if (!png_base64 && !storage_key) {
    return res.status(400).json({ ok: false, error: "storage_key or png_base64 is required" });
  }
  const bytes = storage_key
    ? Number(reportedBytes) || null
    : Buffer.from(png_base64, "base64").length;

  await pool.query(
    `INSERT INTO order_images (order_id, png, storage_key, bytes, prompt)
     VALUES ($1, CASE WHEN $2::text IS NULL THEN NULL ELSE decode($2,'base64') END, $3, $4, $5)
     ON CONFLICT (order_id) DO UPDATE
       SET png = EXCLUDED.png, storage_key = EXCLUDED.storage_key,
           bytes = EXCLUDED.bytes, prompt = EXCLUDED.prompt`,
    [req.params.id, png_base64 ?? null, storage_key ?? null, bytes, prompt ?? null],
  );
  res.json({ ok: true, data: { order_id: req.params.id, bytes, storage_key: storage_key ?? null } });
});

app.get("/v1/orders/:id/image", async (req, res) => {
  const { rows } = await pool.query(
    // Same as the clips: once there is a key, the caller reads from the bucket.
    `SELECT storage_key, COALESCE(bytes, octet_length(png)) AS bytes,
            CASE WHEN storage_key IS NULL THEN encode(png,'base64') END AS png_base64
       FROM order_images WHERE order_id = $1`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ ok: false, error: "no image for that order" });
  res.json({ ok: true, data: rows[0] });
});

/** The person doing a job says it is finished. */
app.post("/v1/orders/:id/done", async (req, res) => {
  const { phone } = req.body ?? {};
  if (!phone) return res.status(400).json({ ok: false, error: "phone is required" });
  const result = await markTaskDone(req.params.id, String(phone));
  if (result.error) return res.status(409).json({ ok: false, error: result.error });
  res.json({ ok: true, data: result });
});

/** The requester confirms it - this is what records payment as due. */
app.post("/v1/orders/:id/confirm", async (req, res) => {
  const { phone, confirmed, note } = req.body ?? {};
  if (!phone) return res.status(400).json({ ok: false, error: "phone is required" });
  if (typeof confirmed !== "boolean") {
    return res.status(400).json({ ok: false, error: "confirmed is required" });
  }
  const result = await confirmTaskDone(
    req.params.id, String(phone), confirmed, note,
  );
  if (result.error) return res.status(409).json({ ok: false, error: result.error });
  res.json({ ok: true, data: result });
});

app.get("/v1/work", async (req, res) => {
  const phone = String(req.query.phone ?? "");
  res.json({
    ok: true,
    data: {
      doing: await listJobsInProgress(phone),
      awaiting_their_confirmation: await listAwaitingConfirmation(phone),
    },
  });
});

/** What is owed, and whether it can actually be paid yet. */
app.get("/v1/payments", async (req, res) => {
  const { rows } = await pool.query(
    // The on-chain signature is the whole proof a payment happened; leaving it
    // out made a settled payment look unsettled.
    `SELECT pay.id, pay.amount_usd, pay.platform_fee_usd, pay.status, pay.stripe_mode,
            pay.railcoins, pay.solana_signature,
            pay.note, pay.created_at, o.title,
            payer.phone AS payer_phone, payee.phone AS payee_phone
       FROM payments pay
       JOIN orders o ON o.id = pay.order_id
       LEFT JOIN people payer ON payer.id = pay.payer_id
       LEFT JOIN people payee ON payee.id = pay.payee_id
      ORDER BY pay.created_at DESC
      LIMIT $1`,
    [Math.min(Number(req.query.limit) || 20, 100)],
  );
  res.json({ ok: true, data: rows });
});

/** A worker's agent asks the requester something about the job. */
app.post("/v1/offers/:id/question", async (req, res) => {
  const { phone, question } = req.body ?? {};
  if (!phone || !question) {
    return res.status(400).json({ ok: false, error: "phone and question are required" });
  }
  const result = await askAboutJob(req.params.id, String(phone), String(question));
  if (result.error) return res.status(409).json({ ok: false, error: result.error });
  res.json({ ok: true, data: result });
});

/** The requester answers it. */
app.post("/v1/questions/:id/answer", async (req, res) => {
  const { phone, answer } = req.body ?? {};
  if (!phone || !answer) {
    return res.status(400).json({ ok: false, error: "phone and answer are required" });
  }
  const result = await answerJobQuestion(req.params.id, String(phone), String(answer));
  if (result.error) return res.status(409).json({ ok: false, error: result.error });
  res.json({ ok: true, data: result });
});

app.get("/v1/questions/open", async (req, res) => {
  const phone = String(req.query.phone ?? "");
  res.json({
    ok: true,
    data: {
      waiting_on_them: await listOpenQuestions(phone),
      they_asked: await listMyQuestions(phone),
    },
  });
});

/**
 * Who is worth phoning, and why. Poll this from the voice platform: each entry
 * is a number to dial plus what the call is about.
 */
app.get("/v1/escalations", async (req, res) => {
  const stale = Number(req.query.stale_minutes) || 20;
  res.json({ ok: true, data: await callWorthy(stale) });
});

/** What each side's agent could act on right now. */
app.get("/v1/negotiation/pending", async (_req, res) => {
  res.json({ ok: true, data: await pendingNegotiation() });
});

/** A worker proposes different terms. */
app.post("/v1/offers/:id/counter", async (req, res) => {
  const { phone, price_usd, note } = req.body ?? {};
  if (!phone || typeof price_usd !== "number" || !Number.isFinite(price_usd) || price_usd <= 0) {
    return res.status(400).json({
      ok: false,
      error: "phone is required and price_usd must be greater than zero",
    });
  }
  const result = await counterOffer(req.params.id, String(phone), price_usd, note);
  if (result.error) return res.status(409).json({ ok: false, error: result.error });
  res.json({ ok: true, data: result });
});

/** The requester answers a counter. */
app.post("/v1/offers/:id/counter/respond", async (req, res) => {
  const { phone, accept, release } = req.body ?? {};
  if (!phone) return res.status(400).json({ ok: false, error: "phone is required" });
  const result = await respondToCounter(req.params.id, Boolean(accept), String(phone), {
    release: Boolean(release),
  });
  if (result.error) return res.status(409).json({ ok: false, error: result.error });
  res.json({ ok: true, data: result });
});

/** Matcher found nobody suitable. Count the miss; park after a few tries. */
app.post("/v1/orders/:id/no-match", async (req, res) => {
  try {
    const result = await recordNoMatch(req.params.id);
    if (!result.counted) return res.status(409).json({ ok: false, error: "not_open" });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/** Counters awaiting a requester's decision. */
app.get("/v1/counters/open", async (req, res) => {
  res.json({ ok: true, data: await listOpenCounters(String(req.query.phone ?? "")) });
});

/**
 * Drop clips made under an older format so the film loop remakes them. A task
 * that still carries a four-second single shot would otherwise keep pitching
 * itself with it long after the treatment changed.
 */
app.post("/v1/dev/refilm", async (req, res) => {
  const minSeconds = Number(req.body?.min_seconds) || 16;
  const { rows } = await pool.query(
    `DELETE FROM order_videos
      WHERE seconds IS NULL OR seconds < $1
      RETURNING order_id, seconds`,
    [minSeconds],
  );
  console.log(`cleared ${rows.length} stale clip(s) for refilming`);
  res.json({ ok: true, data: { cleared: rows.length, orders: rows } });
});

/**
 * Re-gate tasks that are already open. The rubric changes as the policy is
 * worked out, and a task allowed under an older version should not stay open
 * just because it got in first.
 */
app.post("/v1/dev/re-review", async (req, res) => {
  // Dry run unless asked otherwise. A sweep that blocks live work on a rubric
  // nobody has eyeballed is how legitimate tasks get cancelled in bulk.
  const apply = req.body?.apply === true;
  const { rows } = await pool.query(
    `SELECT id, title, details, category, pickup_location, dropoff_location,
            budget_usd, deadline_at
       FROM orders
      WHERE status IN ('submitted', 'offered', 'accepted')`,
  );

  const blocked: Array<{ id: string; title: string; reason: string; told: number }> = [];
  const kept: string[] = [];
  const unreviewed: string[] = [];

  for (const order of rows) {
    const verdict = await reviewTask(order);
    if (!verdict) {
      unreviewed.push(order.title);
      continue;
    }
    if (verdict.verdict === "BLOCK") {
      const reason = verdict.reason ?? "No longer allowed under the current policy.";
      const result = apply ? await blockOrder(order.id, reason) : null;
      blocked.push({
        id: order.id,
        title: order.title,
        reason,
        told: result && "told" in result ? (result.told ?? 0) : 0,
      });
      continue;
    }
    if (!apply) { kept.push(order.title); continue; }
    await pool.query(
      `UPDATE orders SET ethics_verdict = $2, ethics_reason = $3 WHERE id = $1`,
      [order.id, verdict.verdict, verdict.reason ?? null],
    );
    kept.push(order.title);
  }

  console.log(`re-review: ${blocked.length} blocked, ${kept.length} kept, ${unreviewed.length} unreviewed`);
  res.json({ ok: true, data: { blocked, kept, unreviewed } });
});

/**
 * Put a wrongly blocked task back. The gate can be wrong - a rule that matches
 * a word rather than a meaning will block real work - and when it is, the task
 * should not need recreating from scratch.
 */
app.post("/v1/orders/:id/unblock", async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE orders
        SET status = 'submitted', ethics_verdict = NULL, ethics_reason = NULL, updated_at = now()
      WHERE id = $1 AND status = 'blocked'
      RETURNING id, title`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ ok: false, error: "not_blocked" });
  console.log(`unblocked ${rows[0].title}: ${req.body?.reason ?? "no reason given"}`);
  res.json({ ok: true, data: rows[0] });
});

/**
 * Clear the board. Everything still in flight is marked finished and every
 * live offer is closed, deliberately WITHOUT queueing a single handoff - this
 * is a reset before a demo, not something the people involved should be
 * texted about. Undelivered handoffs and pending trailers are cleared for the
 * same reason: a backlog that fires afterwards is still a burst of texts.
 */
app.post("/v1/dev/close-all", async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const offers = await client.query(
      `UPDATE job_offers SET status = 'cancelled', responded_at = now()
        WHERE status IN ('offered', 'accepted', 'countered')
        RETURNING id`,
    );
    const orders = await client.query(
      `UPDATE orders
          SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
        WHERE status NOT IN ('completed', 'cancelled')
        RETURNING id, title`,
    );
    // Nothing queued may fire after this runs.
    const handoffs = await client.query(
      `DELETE FROM agent_handoffs WHERE delivered_at IS NULL RETURNING id`,
    );
    const trailers = await client.query(
      `UPDATE order_videos SET delivered_at = now() WHERE delivered_at IS NULL RETURNING order_id`,
    );

    await client.query("COMMIT");
    console.log(
      `closed ${orders.rowCount} task(s), ${offers.rowCount} offer(s); ` +
        `dropped ${handoffs.rowCount} queued message(s), ${trailers.rowCount} pending trailer(s)`,
    );
    res.json({
      ok: true,
      data: {
        tasks_closed: orders.rowCount,
        offers_closed: offers.rowCount,
        queued_messages_dropped: handoffs.rowCount,
        pending_trailers_suppressed: trailers.rowCount,
        titles: orders.rows.map((r) => r.title),
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ ok: false, error: (err as Error).message });
  } finally {
    client.release();
  }
});

/** One click from the requester: it arrived, pay them. */
app.post("/v1/orders/:id/received", async (req, res) => {
  try {
    const phone = req.body?.phone ? String(req.body.phone) : undefined;
    if (!phone) return res.status(400).json({ ok: false, error: "phone is required" });
    const result = await receiveAndPay(req.params.id, phone);
    if ("error" in result && result.error) {
      return res.status(409).json({ ok: false, error: result.error });
    }
    console.log(`received+paid ${req.params.id}`);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/**
 * The requester asks for a film and pays for it. Charged before anything is
 * generated: a fee taken after the fact is one the person never agreed to, and
 * a film is minutes of expensive rendering.
 */
app.post("/v1/orders/:id/film", async (req, res) => {
  const fee = Number(process.env.FILM_FEE_RAILCOINS || 5);
  const claimed = await pool.query(
    `UPDATE orders o
        SET film_requested_at = now(), updated_at = now()
       FROM people p
      WHERE o.id = $1 AND p.id = o.person_id
        AND o.status IN ('submitted', 'offered', 'accepted', 'done_pending')
        AND (
          o.film_requested_at IS NULL
          OR (
            o.film_paid_signature IS NULL
            AND o.film_requested_at < now() - interval '5 minutes'
          )
        )
      RETURNING o.id, o.title, p.phone AS requester_phone`,
    [req.params.id],
  );
  const order = claimed.rows[0];
  if (!order) {
    const existing = await pool.query(
      `SELECT o.id, o.status, o.film_requested_at, o.film_paid_signature
         FROM orders o WHERE o.id = $1`,
      [req.params.id],
    );
    if (!existing.rows[0]) {
      return res.status(404).json({ ok: false, error: "no_such_task" });
    }
    if (!["submitted", "offered", "accepted", "done_pending"].includes(existing.rows[0].status)) {
      return res.status(409).json({ ok: false, error: "task_not_filmable" });
    }
    return res.status(409).json({
      ok: false,
      error: existing.rows[0].film_paid_signature ? "already_requested" : "request_in_progress",
    });
  }
  if (!order.requester_phone) {
    await pool.query(
      `UPDATE orders SET film_requested_at = NULL
        WHERE id = $1 AND film_paid_signature IS NULL`,
      [order.id],
    );
    return res.status(409).json({ ok: false, error: "no_requester" });
  }

  const charge = await chargeToTreasury(order.requester_phone, fee, `film:${order.id}`);
  if (!charge.settled) {
    await pool.query(
      `UPDATE orders SET film_requested_at = NULL, updated_at = now()
        WHERE id = $1 AND film_paid_signature IS NULL`,
      [order.id],
    );
    return res.status(402).json({ ok: false, error: "payment_failed", reason: charge.reason });
  }

  const saved = await pool.query(
    `UPDATE orders SET film_requested_at = now(), film_paid_signature = $2, updated_at = now()
      WHERE id = $1
      RETURNING id`,
    [order.id, charge.signature],
  );
  if (!saved.rows[0]) {
    return res.status(500).json({ ok: false, error: "could_not_record_film_payment" });
  }
  console.log(`film requested for "${order.title}" - charged ${fee} railcoins`);
  res.json({
    ok: true,
    data: { queued: true, railcoins: fee, signature: charge.signature, title: order.title },
  });
});

/** Someone volunteering for a task nobody offered them. */
app.post("/v1/orders/:id/claim", async (req, res) => {
  const phone = req.body?.phone;
  if (!phone) return res.status(400).json({ ok: false, error: "phone is required" });
  try {
    const result = await claimTask(req.params.id, String(phone));
    if ("error" in result && result.error) {
      return res.status(409).json({ ok: false, error: result.error });
    }
    console.log(`claimed ${req.params.id} by ${phone}`);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

/** Call a task off, telling anyone who was holding it. */
app.post("/v1/orders/:id/cancel", async (req, res) => {
  try {
    const result = await cancelOrder(req.params.id, req.body?.reason);
    if (result.error) return res.status(409).json({ ok: false, error: result.error });
    console.log(`cancelled order ${req.params.id} (told ${result.told})`);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

/** Point an order at the person who actually requested it. */
app.post("/v1/orders/:id/reassign", async (req, res) => {
  const phone = req.body?.phone;
  if (!phone) return res.status(400).json({ ok: false, error: "phone is required" });
  try {
    const result = await reassignOrder(req.params.id, String(phone));
    if (result.error) return res.status(404).json({ ok: false, error: result.error });
    console.log(`reassigned order ${req.params.id} to ${result.requester}`);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Signup, from the website. The site holds the Auth0 session; this service
// holds the accounts, so the site posts what it knows and nothing more.
// ---------------------------------------------------------------------------

app.post("/v1/signup", async (req, res) => {
  const { auth0_sub, email, display_name, phone, blurb, categories, min_price_usd, wants_work } =
    req.body ?? {};
  if (!auth0_sub || !phone) {
    return res.status(400).json({ ok: false, error: "auth0_sub and phone are required" });
  }
  try {
    const result = await registerSignup({
      auth0_sub: String(auth0_sub),
      email: String(email ?? ""),
      display_name: display_name ? String(display_name) : undefined,
      phone: String(phone),
      blurb: blurb ? String(blurb) : undefined,
      categories: Array.isArray(categories) ? categories.map(String) : undefined,
      min_price_usd: min_price_usd != null ? Number(min_price_usd) : undefined,
      wants_work: wants_work !== false,
    });
    if ("error" in result && result.error) {
      return res.status(409).json({ ok: false, error: result.error });
    }
    console.log(`signup ${auth0_sub} -> ${phone} (code_sent=${"code_sent" in result && result.code_sent})`);
    res.json({ ok: true, data: result });
  } catch (err) {
    // A mis-typed number fails here, loudly, rather than becoming a person.
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/v1/signup/verify", async (req, res) => {
  const { auth0_sub, code } = req.body ?? {};
  if (!auth0_sub || !code) {
    return res.status(400).json({ ok: false, error: "auth0_sub and code are required" });
  }
  const result = await verifySignup(String(auth0_sub), String(code));
  if ("error" in result && result.error) {
    return res.status(400).json({ ok: false, error: result.error, data: result });
  }
  console.log(`verified ${auth0_sub}`);
  res.json({ ok: true, data: result });
});

app.get("/v1/signup/status", async (req, res) => {
  const sub = String(req.query.auth0_sub ?? "");
  if (!sub) return res.status(400).json({ ok: false, error: "auth0_sub is required" });
  res.json({ ok: true, data: await signupStatus(sub) });
});

app.post("/v1/signup/availability", async (req, res) => {
  const { auth0_sub, available } = req.body ?? {};
  if (!auth0_sub) return res.status(400).json({ ok: false, error: "auth0_sub is required" });
  const result = await setAvailability(String(auth0_sub), available !== false);
  if ("error" in result && result.error) {
    return res.status(404).json({ ok: false, error: result.error });
  }
  res.json({ ok: true, data: result });
});

/** One order, whatever its status - so a view of a task can show where it runs. */
app.get("/v1/orders/:id", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.details, o.category, o.pickup_location, o.dropoff_location,
            o.deadline_at, o.budget_usd, o.urgency, o.status, o.created_at,
            o.film_requested_at, o.film_paid_signature,
            p.phone AS requester_phone,
            pay.status AS payment_status, pay.solana_signature
       FROM orders o
       LEFT JOIN people p ON p.id = o.person_id
       LEFT JOIN payments pay ON pay.order_id = o.id
      WHERE o.id = $1`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ ok: false, error: "no such order" });
  res.json({ ok: true, data: rows[0] });
});

/**
 * Whether this person may be pictured in generated media, and the photo to do
 * it with. Server-to-server only: the photo never goes to a browser from here,
 * and an absent consent is a no rather than a maybe.
 */
app.get("/v1/people/likeness", async (req, res) => {
  const phone = String(req.query.phone ?? "");
  if (!phone) return res.status(400).json({ ok: false, error: "phone is required" });
  const { rows } = await pool.query(
    `SELECT avatar_data_url,
            COALESCE((doc->'consents'->>'canUseLikeness')::boolean, false) AS consented
       FROM people WHERE phone = $1`,
    [normalizePhone(phone)],
  );
  const row = rows[0];
  const consented = Boolean(row?.consented);
  const hasPhoto = Boolean(row?.avatar_data_url);
  res.json({
    ok: true,
    data: {
      consented,
      has_photo: hasPhoto,
      // Only handed over when both are true - there is no reason to move a
      // photo around for someone who said no.
      avatar_data_url: consented && hasPhoto ? row.avatar_data_url : null,
    },
  });
});

/** Recent orders, with where they came from. */
app.get("/v1/orders", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.title, o.source, o.call_id, o.status, o.budget_usd,
            o.category, o.deadline_at, o.created_at, p.phone
       FROM orders o
       LEFT JOIN people p ON p.id = o.person_id
      ORDER BY o.created_at DESC
      LIMIT $1`,
    [Math.min(Number(req.query.limit) || 20, 100)],
  );
  res.json({ ok: true, data: rows });
});

/** Recent calls, for checking what the voice agent actually did. */
app.get("/v1/calls", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.caller_phone, c.agent, c.external_call_id, c.status,
            c.started_at, c.ended_at, c.summary, c.resolution, c.resolution_status,
            (SELECT count(*) FROM call_notes n WHERE n.call_id = c.id)::int AS note_count,
            (SELECT count(*) FROM orders o WHERE o.call_id = c.id)::int AS order_count
       FROM calls c
      ORDER BY c.started_at DESC
      LIMIT $1`,
    [Math.min(Number(req.query.limit) || 20, 100)],
  );
  res.json({ ok: true, data: rows });
});

/** What the iMessage agent polls: calls and orders it hasn't told anyone about yet. */
app.get("/v1/handoffs", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT h.*, c.summary, c.resolution, c.resolution_status
       FROM agent_handoffs h
       LEFT JOIN calls c ON c.id = h.call_id
      WHERE h.delivered_at IS NULL
      ORDER BY h.created_at
      LIMIT $1`,
    [Math.min(Number(req.query.limit) || 20, 100)],
  );
  res.json({ ok: true, data: rows });
});

app.post("/v1/handoffs/:id/delivered", async (req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE agent_handoffs SET delivered_at = now()
      WHERE id = $1 AND delivered_at IS NULL`,
    [req.params.id],
  );
  res.json({ ok: true, marked: rowCount });
});

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`gotchu-voice-mcp listening on ${PORT}`);
      console.log(`tools: ${tools.map((t) => t.name).join(", ")}`);
    });
  })
  .catch((err) => {
    console.error("schema init failed", err);
    process.exit(1);
  });
