CREATE TABLE IF NOT EXISTS users (
  uuid TEXT PRIMARY KEY,
  cmu_email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL UNIQUE,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  requester_uuid TEXT NOT NULL,
  status TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_requester_created_idx
  ON tasks (requester_uuid, created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_status_idx
  ON tasks (status);

CREATE TABLE IF NOT EXISTS task_candidates (
  candidate_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  worker_uuid TEXT NOT NULL,
  matching_run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  rank INTEGER NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, worker_uuid, matching_run_id)
);

CREATE INDEX IF NOT EXISTS task_candidates_task_status_idx
  ON task_candidates (task_id, status);
CREATE INDEX IF NOT EXISTS task_candidates_worker_idx
  ON task_candidates (worker_uuid, created_at DESC);
CREATE INDEX IF NOT EXISTS task_candidates_run_idx
  ON task_candidates (matching_run_id);

CREATE TABLE IF NOT EXISTS matching_runs (
  matching_run_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS matching_runs_task_idx
  ON matching_runs (task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS negotiations (
  negotiation_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  requester_uuid TEXT NOT NULL,
  worker_uuid TEXT NOT NULL,
  state TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS negotiations_task_state_idx
  ON negotiations (task_id, state);

CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  provider_message_id TEXT UNIQUE,
  user_uuid TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_user_idx
  ON messages (user_uuid, created_at DESC);

CREATE TABLE IF NOT EXISTS task_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  doc JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS task_events_task_created_idx
  ON task_events (task_id, created_at);

CREATE TABLE IF NOT EXISTS reviews (
  review_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  rater_uuid TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, rater_uuid)
);

CREATE TABLE IF NOT EXISTS agreements (
  agreement_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
