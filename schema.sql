-- North China Metal Sourcing — D1 schema
-- Run with:  npx wrangler d1 execute ncm-sourcing --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS inquiries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company           TEXT NOT NULL,
  name              TEXT NOT NULL,
  email             TEXT NOT NULL,
  whatsapp          TEXT,
  country           TEXT NOT NULL,
  category          TEXT NOT NULL,
  specification     TEXT NOT NULL,
  quantity          TEXT NOT NULL,
  destination_port  TEXT NOT NULL,
  delivery_window   TEXT,
  order_frequency   TEXT,
  inspection_needed TEXT,
  notes             TEXT,
  ip                TEXT,
  ip_country        TEXT,
  user_agent        TEXT,
  status            TEXT NOT NULL DEFAULT 'new',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_email   ON inquiries (email);

-- Optional: a short internal note column for the first reply
-- ALTER TABLE inquiries ADD COLUMN first_reply_at TEXT;
