import type { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Isolates the experimental `node:sqlite` built-in behind a single access
// point. Requires Node >= 24. The built-in is resolved lazily (only when a
// database is actually opened) so static build analysis never touches it.
let instance: DatabaseSync | undefined;

export function openDatabase(): DatabaseSync {
  if (instance) return instance;
  const dir = resolve(process.env.DATA_DIR || 'data');
  mkdirSync(dir, { recursive: true });
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  instance = new DatabaseSync(resolve(dir, 'zeitklar.sqlite'));
  instance.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, breakMinutes INTEGER NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL, source TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', UNIQUE(date,start,end,kind));
    CREATE TABLE IF NOT EXISTS settlements (month TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS continued_pay (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE, value TEXT NOT NULL, importedAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS report_period ON reports(period,id);
    CREATE TABLE IF NOT EXISTS pending_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE, value TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS pending_report_period ON pending_reports(period,id);
    CREATE TABLE IF NOT EXISTS pending_entry_imports (id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT NOT NULL UNIQUE, value TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS review_acknowledgements (reportKey TEXT NOT NULL, checkKey TEXT NOT NULL, acknowledgedAt TEXT NOT NULL, PRIMARY KEY(reportKey,checkKey));
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const columns = instance.prepare('PRAGMA table_info(entries)').all();
  if (!columns.some(c => c.name === 'meta'))
    instance.exec("ALTER TABLE entries ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'");
  return instance;
}
