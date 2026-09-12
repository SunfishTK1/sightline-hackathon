import { closePool, query } from "../src/lib/db/client";
import { loadEnv } from "./load-env";

async function main() {
  loadEnv();
  const phone = "+14808497383";

  const users = await query<{ uuid: string; first_name: string; last_name: string; phone: string }>(
    `SELECT uuid, doc->>'firstName' AS first_name, doc->>'lastName' AS last_name, phone
     FROM users
     WHERE phone = $1 OR doc->>'phone' = $1`,
    [phone],
  );

  console.log("USERS");
  console.log(JSON.stringify(users.rows, null, 2));

  const uuids = users.rows.map((row) => row.uuid);
  if (uuids.length === 0) {
    const messagesByPhone = await query<{ doc: unknown }>(
      `SELECT doc FROM messages
       WHERE doc->>'body' ILIKE $1
       ORDER BY created_at ASC`,
      [`%480%`],
    );
    console.log("NO USER MATCH; messages mentioning 480");
    console.log(JSON.stringify(messagesByPhone.rows, null, 2));
    return;
  }

  const messages = await query<{ doc: unknown }>(
    `SELECT doc FROM messages
     WHERE user_uuid = ANY($1::text[])
     ORDER BY created_at ASC`,
    [uuids],
  );
  console.log("MESSAGES");
  console.log(JSON.stringify(messages.rows.map((row) => row.doc), null, 2));

  const events = await query<{ doc: unknown }>(
    `SELECT doc FROM task_events
     WHERE doc->'metadata'->>'userUuid' = ANY($1::text[])
        OR task_id IN (
          SELECT task_id FROM tasks WHERE requester_uuid = ANY($1::text[])
        )
     ORDER BY created_at ASC`,
    [uuids],
  );
  console.log("TASK_EVENTS");
  console.log(JSON.stringify(events.rows.map((row) => row.doc), null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
