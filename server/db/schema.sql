CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS drivers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  plate_number TEXT NOT NULL DEFAULT '',
  driver_password_hash TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS drivers_plate_number_unique
  ON drivers (plate_number)
  WHERE plate_number <> '';

CREATE TABLE IF NOT EXISTS bot_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_telegram_update_id BIGINT NOT NULL DEFAULT 0,
  last_bot_message_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION NULL,
  lon DOUBLE PRECISION NULL,
  comment TEXT NOT NULL DEFAULT '',
  assigned_driver_name TEXT NULL REFERENCES drivers(name) ON UPDATE CASCADE ON DELETE SET NULL,
  route_order INTEGER NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  before_photo TEXT NULL,
  after_photo TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'dispatcher' CHECK (source IN ('dispatcher', 'telegram')),
  reporter_name TEXT NOT NULL DEFAULT '',
  reporter_username TEXT NOT NULL DEFAULT '',
  reporter_chat_id BIGINT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS tasks_driver_route_unique
  ON tasks (assigned_driver_name, route_order)
  WHERE assigned_driver_name IS NOT NULL AND route_order IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);
CREATE INDEX IF NOT EXISTS tasks_driver_idx ON tasks (assigned_driver_name);
CREATE INDEX IF NOT EXISTS tasks_created_at_idx ON tasks (created_at DESC);

CREATE TABLE IF NOT EXISTS driver_locations (
  driver_name TEXT PRIMARY KEY REFERENCES drivers(name) ON UPDATE CASCADE ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION NULL,
  heading DOUBLE PRECISION NULL,
  speed DOUBLE PRECISION NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS driver_locations_updated_at_idx
  ON driver_locations (updated_at DESC);

INSERT INTO bot_state (id, last_telegram_update_id, last_bot_message_at)
VALUES (1, 0, NULL)
ON CONFLICT (id) DO NOTHING;
