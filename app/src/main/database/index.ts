import path from 'node:path';

import Database from 'better-sqlite3';

let db: Database.Database | null = null;

const CREATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  join_date TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  trans_time TEXT NOT NULL,
  type TEXT NOT NULL,
  price TEXT NOT NULL,
  total_shares TEXT NOT NULL,
  total_amount TEXT NOT NULL,
  total_extra_expense TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transaction_details (
  id TEXT PRIMARY KEY,
  trans_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  shares TEXT NOT NULL,
  amount TEXT NOT NULL,
  extra_expense TEXT NOT NULL,
  net_cash TEXT NOT NULL,
  cost_adjust TEXT NOT NULL,
  realized_profit TEXT NOT NULL,
  additional_deposit TEXT NOT NULL DEFAULT '0',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (trans_id) REFERENCES transactions(id),
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS ledger_snapshots (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  as_of_time TEXT NOT NULL,
  cash TEXT NOT NULL,
  shares TEXT NOT NULL,
  cost TEXT NOT NULL,
  avg_price TEXT NOT NULL,
  realized_profit TEXT NOT NULL,
  checksum TEXT NOT NULL,
  event_id TEXT NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  as_of_time TEXT NOT NULL,
  total_cash TEXT NOT NULL,
  total_shares TEXT NOT NULL,
  checksum TEXT NOT NULL,
  event_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_member_seq ON ledger_snapshots(member_id, seq);
CREATE INDEX IF NOT EXISTS idx_transactions_time ON transactions(trans_time);
CREATE INDEX IF NOT EXISTS idx_transaction_details_trans ON transaction_details(trans_id);
`;

export const initializeDatabase = (userDataPath: string): Database.Database => {
  if (db) {
    return db;
  }

  const databasePath = path.join(userDataPath, 'temustock.db');
  db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_SCHEMA_SQL);

  return db;
};

export const getDatabase = (): Database.Database => {
  if (!db) {
    throw new Error('Database has not been initialized.');
  }
  return db;
};
