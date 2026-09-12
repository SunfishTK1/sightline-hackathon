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

-- Closed deals: what this kind of hop usually pays.
CREATE TABLE IF NOT EXISTS market_comps (
  comp_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  pickup TEXT,
  dropoff TEXT,
  distance_m INTEGER,
  duration_min INTEGER,
  paid_usd NUMERIC(10,2) NOT NULL,
  order_id TEXT,
  source TEXT NOT NULL DEFAULT 'broker',
  agreed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS market_comps_lookup_idx
  ON market_comps (category, distance_m, duration_min, agreed_at DESC);

-- Public requester progress page. Token is the URL; no names or phones.
CREATE TABLE IF NOT EXISTS live_boards (
  token TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT,
  deadline_at TIMESTAMPTZ,
  offer_timeout_ms INTEGER NOT NULL DEFAULT 600000,
  status TEXT NOT NULL DEFAULT 'matching',
  skip_requested BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS live_candidates (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL REFERENCES live_boards(token) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  color TEXT NOT NULL,
  state TEXT NOT NULL,
  offer_id TEXT,
  waiting_until TIMESTAMPTZ,
  UNIQUE (token, slot)
);

CREATE TABLE IF NOT EXISTS live_events (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL REFERENCES live_boards(token) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  slot INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS live_events_token_idx
  ON live_events (token, created_at DESC);
CREATE INDEX IF NOT EXISTS live_boards_skip_idx
  ON live_boards (skip_requested) WHERE skip_requested;

CREATE TABLE IF NOT EXISTS live_media (
  token TEXT NOT NULL REFERENCES live_boards(token) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  content_type TEXT,
  storage_key TEXT,
  bytes BYTEA,
  prompt TEXT,
  progress INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (token, kind)
);

ALTER TABLE live_media ADD COLUMN IF NOT EXISTS storage_key TEXT;

CREATE TABLE IF NOT EXISTS live_messages (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL REFERENCES live_boards(token) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS live_messages_token_idx
  ON live_messages (token, created_at);
