/**
 * SQLite storage adapter. Loads the whole workspace as a Snapshot inside a transaction, lets the
 * shared operations in `../workspace` change it, and rewrites only the tables whose rows changed.
 * The functions below the adapter are thin synchronous wrappers kept for scripts and tests.
 */
import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { openDatabase } from './sqlite';
import { applyContinuedPayAction } from '../continued-pay';
import type { Mutate } from '../actions';
import type { Entry, Rules, Settlement } from '../model';
import type { TimeReport } from '../report';
import { reportSignature } from '../report-signature';
import { entryPreviewSignature, type EntryPreview } from '../upload';
import * as workspace from '../workspace';
import { normalizeSnapshot, type Snapshot } from '../workspace';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => JSON.stringify(value);

/** Canonical row values per table; equal rows mean the table needs no write. */
function rows(s: Snapshot) {
  return {
    settings: [[1, json(s.rules)]],
    entries: [...s.entries]
      .sort((a, b) => a.id! - b.id!)
      .map(e => [e.id!, e.date, e.start, e.end, e.breakMinutes, e.kind, e.note, e.source ?? '', json(e.meta ?? {})]),
    settlements: s.settlements.map(v => [v.month, json(v)]),
    continued_pay: [[1, json(s.continuedPay)]],
    reports: s.reports.map(v => [v.report.period, sha256(reportSignature(v.report)), json(v.report), v.importedAt]),
    pending_reports: s.pendingReports.map(v => [
      v.id,
      v.report.period,
      sha256(reportSignature(v.report)),
      json(v.report),
      v.createdAt
    ]),
    pending_entry_imports: s.pendingEntryImports.map(v => [
      v.id,
      sha256(entryPreviewSignature(v.preview)),
      json(v.preview),
      v.createdAt
    ]),
    review_acknowledgements: s.acknowledgements.map(v => [v.reportKey, v.checkKey, v.acknowledgedAt]),
    meta: [
      ['schemaVersion', String(s.schemaVersion)],
      ['nextId', String(s.nextId)]
    ]
  } satisfies Record<string, (string | number)[][]>;
}
type Rows = ReturnType<typeof rows>;

const insert: Record<keyof Rows, string> = {
  settings: 'INSERT INTO settings(id,value) VALUES (?,?)',
  entries: 'INSERT INTO entries(id,date,start,end,breakMinutes,kind,note,source,meta) VALUES (?,?,?,?,?,?,?,?,?)',
  settlements: 'INSERT INTO settlements(month,value) VALUES (?,?)',
  continued_pay: 'INSERT INTO continued_pay(id,value) VALUES (?,?)',
  reports: 'INSERT INTO reports(period,fingerprint,value,importedAt) VALUES (?,?,?,?)',
  pending_reports: 'INSERT INTO pending_reports(id,period,fingerprint,value,createdAt) VALUES (?,?,?,?,?)',
  pending_entry_imports: 'INSERT INTO pending_entry_imports(id,fingerprint,value,createdAt) VALUES (?,?,?,?)',
  review_acknowledgements: 'INSERT INTO review_acknowledgements(reportKey,checkKey,acknowledgedAt) VALUES (?,?,?)',
  meta: 'INSERT INTO meta(key,value) VALUES (?,?)'
};

function load(database: DatabaseSync): { snapshot: Snapshot; stored: Rows } {
  const all = (sql: string) => database.prepare(sql).all() as Record<string, string | number>[];
  const one = (sql: string) => database.prepare(sql).get() as { value: string } | undefined;
  const meta = new Map(all('SELECT key,value FROM meta').map(row => [String(row.key), String(row.value)]));
  const settings = one('SELECT value FROM settings WHERE id=1');
  const continuedPay = one('SELECT value FROM continued_pay WHERE id=1');
  const raw = {
    version: 1,
    schemaVersion: Number(meta.get('schemaVersion') ?? 1),
    nextId: Number(meta.get('nextId') ?? 0),
    rules: settings ? JSON.parse(settings.value) : undefined,
    entries: all('SELECT * FROM entries ORDER BY id').map(row => ({ ...row, meta: JSON.parse(String(row.meta)) })),
    settlements: all('SELECT value FROM settlements ORDER BY month').map(row => JSON.parse(String(row.value))),
    continuedPay: continuedPay ? JSON.parse(continuedPay.value) : undefined,
    reports: all('SELECT value,importedAt FROM reports ORDER BY id').map(row => ({
      report: JSON.parse(String(row.value)),
      importedAt: String(row.importedAt)
    })),
    pendingReports: all('SELECT id,value,createdAt FROM pending_reports ORDER BY id').map(row => ({
      id: Number(row.id),
      report: JSON.parse(String(row.value)),
      createdAt: String(row.createdAt)
    })),
    pendingEntryImports: all('SELECT id,value,createdAt FROM pending_entry_imports ORDER BY id').map(row => ({
      id: Number(row.id),
      preview: JSON.parse(String(row.value)),
      createdAt: String(row.createdAt)
    })),
    acknowledgements: all('SELECT reportKey,checkKey,acknowledgedAt FROM review_acknowledgements').map(row => ({
      reportKey: String(row.reportKey),
      checkKey: String(row.checkKey),
      acknowledgedAt: String(row.acknowledgedAt)
    }))
  } as unknown as Snapshot;
  // Defaults filled in by normalization are no reason to rewrite; only a real change is.
  const stored = rows({
    ...raw,
    rules: raw.rules ?? (null as unknown as Rules),
    continuedPay: raw.continuedPay ?? (null as unknown as Snapshot['continuedPay'])
  });
  if (!settings) stored.settings = [];
  if (!continuedPay) stored.continued_pay = [];
  return { snapshot: normalizeSnapshot(raw), stored };
}

function save(database: DatabaseSync, snapshot: Snapshot, stored: Rows) {
  const next = rows(normalizeSnapshot(snapshot));
  for (const table of Object.keys(next) as (keyof Rows)[]) {
    if (json(next[table]) === json(stored[table])) continue;
    database.exec(`DELETE FROM ${table}`);
    const statement = database.prepare(insert[table]);
    for (const row of next[table]) statement.run(...row);
  }
}

let migrated = false;
function db(): DatabaseSync {
  const database = openDatabase();
  if (!migrated) {
    migrated = true;
    // Persist schema migrations once instead of repeating them on every read.
    const row = database.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get() as
      { value: string } | undefined;
    if (Number(row?.value ?? 1) < workspace.SCHEMA_VERSION) mutateSync(() => undefined);
  }
  return database;
}

export function mutateSync<T>(fn: (snapshot: Snapshot) => T): T {
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const { snapshot, stored } = load(database);
    const result = fn(snapshot);
    save(database, snapshot, stored);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export const mutate: Mutate = async fn => mutateSync(fn);

export function readSnapshot(): Snapshot {
  const database = db();
  database.exec('BEGIN');
  try {
    return load(database).snapshot;
  } finally {
    database.exec('COMMIT');
  }
}

// --- Synchronous convenience wrappers (scripts and tests) ---

export const getRules = (): Rules => readSnapshot().rules;
export const saveRules = (rules: Rules) =>
  mutateSync(s => {
    s.rules = rules;
  });
export const getEntries = (): Entry[] => readSnapshot().entries;
export const saveEntries = (entries: Entry[], source: string, editId?: number) =>
  mutateSync(s => workspace.addEntries(s, entries, source, editId));
export const deleteEntry = (id: number) => mutateSync(s => workspace.deleteEntry(s, id));
export const getSettlement = (month: string): Settlement => workspace.getSettlement(readSnapshot(), month);
export const getSettlements = (): Settlement[] => readSnapshot().settlements;
export const saveSettlement = (value: Settlement) => mutateSync(s => workspace.saveSettlement(s, value));
export const getContinuedPay = () => readSnapshot().continuedPay;
export const updateContinuedPay = (form: FormData) =>
  mutateSync(s => {
    s.continuedPay = applyContinuedPayAction(s.continuedPay, form, workspace.latestReports(s), s.rules);
  });
export const getReport = (month: string): TimeReport | null =>
  workspace.latestReports(readSnapshot()).find(report => report.period === month) ?? null;
export const getReports = (): TimeReport[] =>
  workspace.latestReports(readSnapshot()).sort((a, b) => b.period.localeCompare(a.period));
export const getReviewAcknowledgements = () => readSnapshot().acknowledgements;
export const setReviewAcknowledgement = (reportKey: string, checkKey: string, acknowledged: boolean) =>
  mutateSync(s => workspace.setReviewAcknowledgement(s, reportKey, checkKey, acknowledged));
export const getReviewData = (month = '') =>
  workspace.buildPage(readSnapshot(), new URL(`http://localhost/?month=${encodeURIComponent(month)}`));
export const saveReport = (report: TimeReport) => mutateSync(s => workspace.addReport(s, report));
export const getPendingReports = () =>
  readSnapshot().pendingReports.sort((a, b) => b.report.period.localeCompare(a.report.period) || a.id - b.id);
export const savePendingReport = (raw: TimeReport, createdAt?: string) =>
  mutateSync(s => workspace.addPendingReport(s, raw, createdAt));
export const confirmPendingReport = (id: number) => mutateSync(s => workspace.confirmPendingReport(s, id));
export const discardPendingReport = (id: number) => mutateSync(s => workspace.discardPendingReport(s, id));
export const getPendingEntryImports = () => readSnapshot().pendingEntryImports;
export const savePendingEntryImport = (raw: EntryPreview, createdAt?: string) =>
  mutateSync(s => workspace.addPendingEntryImport(s, raw, createdAt));
export const confirmPendingEntryImport = (id: number, editedEntries?: unknown) =>
  mutateSync(s => workspace.confirmPendingEntryImport(s, id, editedEntries));
export const discardPendingEntryImport = (id: number) => mutateSync(s => workspace.discardPendingEntryImport(s, id));
export const getMonths = () => workspace.workspaceMonths(readSnapshot());
export const exportData = () => workspace.exportSnapshot(readSnapshot());
