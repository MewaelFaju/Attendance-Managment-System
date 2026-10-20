const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS employees (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role       TEXT NOT NULL,
    id_card    TEXT NOT NULL UNIQUE,
    photo      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
    employee_id   INTEGER REFERENCES employees(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    check_in    TEXT NOT NULL,
    check_out   TEXT,
    status      TEXT NOT NULL CHECK (status IN ('present', 'late')),
    UNIQUE (employee_id, date)
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);

  CREATE TABLE IF NOT EXISTS permission_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date         TEXT NOT NULL,
    reason       TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
    manager_note TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS fieldwork_days (
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    PRIMARY KEY (employee_id, date)
  );

  CREATE TABLE IF NOT EXISTS permission_days (
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    PRIMARY KEY (employee_id, date)
  );
`;

function openDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  // Added after the first release: lets an admin grant an employee the report filters.
  const hasFilterColumn = db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'can_filter_reports');
  if (!hasFilterColumn) db.exec('ALTER TABLE users ADD COLUMN can_filter_reports INTEGER NOT NULL DEFAULT 0');
  return db;
}

// Runs fn inside a transaction; rolls back if it throws.
function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, transaction };
