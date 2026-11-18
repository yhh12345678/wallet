CREATE TABLE wallet_ledgers (
  id TEXT PRIMARY KEY NOT NULL,
  document TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  invite_hash TEXT UNIQUE,
  invite_until INTEGER
);
--> statement-breakpoint
CREATE TABLE wallet_members (
  ledger_id TEXT NOT NULL REFERENCES wallet_ledgers(id),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (ledger_id, user_id)
);
--> statement-breakpoint
CREATE INDEX wallet_members_by_user ON wallet_members(user_id, active);
