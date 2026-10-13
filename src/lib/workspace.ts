/**
 * The complete persisted workspace and every operation on it, shared by the SQLite server
 * and the IndexedDB browser build. Storage adapters only load and save a Snapshot inside a
 * transaction; all validation, merging and derived page data live here.
 */
import { migrateOpeningRules, resolveMonthSettlement } from './balance';
import { checkEntryConflict } from './entry-conflicts';
import {
  defaultRules,
  emptySettlement,
  migrateRules,
  migrateSettlement,
  validateEntry,
  validateRules,
  validMonth,
  type Entry,
  type Rules,
  type Settlement
} from './model';
import type { PendingReport, TimeReport } from './report';
import {
  getReportReview,
  getReviewMonths,
  validateReviewAcknowledgement,
  type ReviewAcknowledgement,
  type ReviewContext
} from './review';
import { validateReport } from './validate-report';
import { reportSignature } from './report-signature';
import { entryPreviewSignature, validateEntryPreview, type EntryPreview, type PendingEntryImport } from './upload';
import {
  continuedPayMonths,
  emptyContinuedPay,
  mergeContinuedPay,
  validateContinuedPay,
  type ContinuedPay
} from './continued-pay';
import { AbsenceCache, automaticContinuedPay, continuedAbsenceMonths } from './sickness';

/**
 * Storage schema version. Steps in `normalizeSnapshot` below this number run once on load and
 * are persisted with the next save; data written by the current version never re-runs them.
 */
export const SCHEMA_VERSION = 2;

export type StoredReport = { report: TimeReport; importedAt: string };
export type Snapshot = {
  /** Backup format version; unchanged since the first release. */
  version: 1;
  schemaVersion: number;
  rules: Rules;
  entries: Entry[];
  settlements: Settlement[];
  /** All confirmed report versions in insertion order; the last one per month is current. */
  reports: StoredReport[];
  pendingReports: PendingReport[];
  pendingEntryImports: PendingEntryImport[];
  acknowledgements: ReviewAcknowledgement[];
  continuedPay: ContinuedPay;
  nextId: number;
};

/** Everything the page renders for one selected month. */
export type WorkspaceData = {
  entries: Entry[];
  rules: Rules;
  settlement: Settlement;
  settlements: Settlement[];
  initialTab: 'Übersicht' | 'Monat';
  month: string;
  months: string[];
  report: TimeReport | null;
  pendingReports: PendingReport[];
  pendingEntryImports: PendingEntryImport[];
  review?: ReviewContext;
  reviewMonths: string[];
  continuedPay: ContinuedPay;
  reports: TimeReport[];
  authWarning?: boolean;
};

export const emptySnapshot = (): Snapshot => ({
  version: 1,
  schemaVersion: SCHEMA_VERSION,
  rules: structuredClone(defaultRules),
  entries: [],
  settlements: [],
  reports: [],
  pendingReports: [],
  pendingEntryImports: [],
  acknowledgements: [],
  continuedPay: emptyContinuedPay(),
  nextId: 1
});

/** Bring stored data of any earlier schema to the current shape. Idempotent. */
export function normalizeSnapshot(raw: Partial<Snapshot> | null | undefined): Snapshot {
  const snapshot = (raw ?? emptySnapshot()) as Snapshot;
  snapshot.version = 1;
  snapshot.rules ??= structuredClone(defaultRules);
  snapshot.entries ??= [];
  snapshot.settlements ??= [];
  snapshot.reports ??= [];
  snapshot.pendingReports ??= [];
  snapshot.pendingEntryImports ??= [];
  snapshot.acknowledgements ??= [];
  if (!(snapshot.schemaVersion >= 2)) {
    // v1 → v2: profiles from before table rates keep manual rates; legacy month openings,
    // including an explicit zero, are marked as entered.
    snapshot.rules = migrateRules(snapshot.rules);
    snapshot.settlements = snapshot.settlements.map(migrateSettlement);
    snapshot.schemaVersion = 2;
  }
  // Not a migration: fields added later get their defaults.
  snapshot.rules = { ...defaultRules, ...snapshot.rules };
  // Not a migration either: a monthly opening saved through the settlement API becomes the
  // global anchor as long as the profile has none. Runs on every load by design.
  snapshot.rules = migrateOpeningRules(snapshot.rules, snapshot.settlements);
  snapshot.continuedPay = validateContinuedPay(snapshot.continuedPay);
  snapshot.settlements.sort((a, b) => a.month.localeCompare(b.month));
  snapshot.entries.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const maxId = [...snapshot.entries, ...snapshot.pendingReports, ...snapshot.pendingEntryImports].reduce(
    (max, value) => (Number.isSafeInteger(value.id) ? Math.max(max, value.id ?? 0) : max),
    0
  );
  snapshot.nextId = Math.max(
    Number.isSafeInteger(snapshot.nextId) && snapshot.nextId > 0 ? snapshot.nextId : 1,
    maxId + 1
  );
  return snapshot;
}

/** Only the newest confirmed version for each month is relevant to the current review. */
export function latestReports(snapshot: Snapshot): TimeReport[] {
  return [...new Map(snapshot.reports.map(value => [value.report.period, value.report])).values()];
}

export function addEntries(snapshot: Snapshot, entries: Entry[], source: string, editId?: number) {
  let inserted = 0,
    duplicates = 0;
  if (editId !== undefined) {
    if (!snapshot.entries.some(e => e.id === editId)) throw new Error('Eintrag nicht gefunden.');
    snapshot.entries = snapshot.entries.filter(e => e.id !== editId);
  }
  for (const input of entries) {
    const e = validateEntry(input);
    const { duplicate, conflict } = checkEntryConflict(e, snapshot.entries);
    if (duplicate) {
      const existingEntry = snapshot.entries.find(
        x => x.date === e.date && x.start === e.start && x.end === e.end && x.kind === e.kind
      )!;
      if (
        editId !== undefined ||
        existingEntry.breakMinutes !== e.breakMinutes ||
        existingEntry.note !== e.note ||
        JSON.stringify(existingEntry.meta ?? {}) !== JSON.stringify(e.meta ?? {})
      )
        throw new Error(
          `${e.date}: Eintrag bereits vorhanden, aber abweichende Daten. Vorhandenen Eintrag bearbeiten.`
        );
      duplicates++;
      continue;
    }
    if (conflict) throw new Error(conflict);
    snapshot.entries.push({ ...e, id: snapshot.nextId++, source });
    inserted++;
  }
  return { inserted, duplicates };
}

export function deleteEntry(snapshot: Snapshot, id: number) {
  if (!Number.isInteger(id) || id < 1) throw new Error('Ungültiger Eintrag.');
  snapshot.entries = snapshot.entries.filter(e => e.id !== id);
}

/** PDF and TXT encodings may differ; an identical structured report is stored only once. */
export function addReport(snapshot: Snapshot, raw: unknown, importedAt = new Date().toISOString()) {
  const report = validateReport(raw),
    signature = reportSignature(report);
  snapshot.pendingReports = snapshot.pendingReports.filter(v => reportSignature(v.report) !== signature);
  if (snapshot.reports.some(v => reportSignature(v.report) === signature)) return false;
  snapshot.reports.push({ report, importedAt });
  return true;
}

export function addPendingReport(snapshot: Snapshot, raw: unknown, createdAt = new Date().toISOString()) {
  const report = validateReport(raw),
    signature = reportSignature(report);
  if (
    snapshot.reports.some(v => reportSignature(v.report) === signature) ||
    snapshot.pendingReports.some(v => reportSignature(v.report) === signature)
  )
    return false;
  snapshot.pendingReports.push({ id: snapshot.nextId++, report, createdAt });
  return true;
}

export function confirmPendingReport(snapshot: Snapshot, id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Ungültiger Zeitnachweis.');
  const pending = snapshot.pendingReports.find(value => value.id === id);
  if (!pending) throw new Error('Der ungeprüfte Zeitnachweis wurde nicht gefunden.');
  const inserted = addReport(snapshot, pending.report);
  snapshot.pendingReports = snapshot.pendingReports.filter(value => value.id !== id);
  return { report: pending.report, inserted };
}

export function discardPendingReport(snapshot: Snapshot, id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Ungültiger Zeitnachweis.');
  if (!snapshot.pendingReports.some(value => value.id === id))
    throw new Error('Der ungeprüfte Zeitnachweis wurde nicht gefunden.');
  snapshot.pendingReports = snapshot.pendingReports.filter(value => value.id !== id);
}

export function addPendingEntryImport(snapshot: Snapshot, raw: EntryPreview, createdAt = new Date().toISOString()) {
  const preview = validateEntryPreview(raw),
    signature = entryPreviewSignature(preview);
  if (snapshot.pendingEntryImports.some(value => entryPreviewSignature(value.preview) === signature)) return false;
  const existing = new Set(snapshot.entries.map(entry => entryPreviewSignature({ ...preview, entries: [entry] })));
  if (preview.entries.every(entry => existing.has(entryPreviewSignature({ ...preview, entries: [entry] }))))
    return false;
  snapshot.pendingEntryImports.push({ id: snapshot.nextId++, preview, createdAt });
  return true;
}

export function confirmPendingEntryImport(snapshot: Snapshot, id: number, editedEntries?: unknown) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Ungültiger Import.');
  const pending = snapshot.pendingEntryImports.find(value => value.id === id);
  if (!pending) throw new Error('Der ungeprüfte Import wurde nicht gefunden.');
  const preview = validateEntryPreview(
    editedEntries === undefined ? pending.preview : { ...pending.preview, entries: editedEntries }
  );
  const result = addEntries(snapshot, preview.entries, preview.filename);
  snapshot.pendingEntryImports = snapshot.pendingEntryImports.filter(value => value.id !== id);
  return { ...result, month: preview.entries[0].date.slice(0, 7) };
}

export function discardPendingEntryImport(snapshot: Snapshot, id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Ungültiger Import.');
  if (!snapshot.pendingEntryImports.some(value => value.id === id))
    throw new Error('Der ungeprüfte Import wurde nicht gefunden.');
  snapshot.pendingEntryImports = snapshot.pendingEntryImports.filter(value => value.id !== id);
}

/** Only a currently open review check can be acknowledged; stale keys are rejected. */
export function setReviewAcknowledgement(
  snapshot: Snapshot,
  reportKey: string,
  checkKey: string,
  acknowledged: boolean
) {
  const value = validateReviewAcknowledgement({ reportKey, checkKey, acknowledgedAt: new Date().toISOString() });
  if (typeof acknowledged !== 'boolean') throw new Error('Ungültige Quittierung.');
  let eligible = false,
    legacyReceiptKey: string | undefined;
  const reports = latestReports(snapshot);
  const continuedPay = snapshot.continuedPay;
  const months = new Set([
    ...reports.map(r => r.period),
    ...continuedAbsenceMonths(snapshot.entries, reports, snapshot.rules),
    ...continuedPayMonths(continuedPay)
  ]);
  const absences = new AbsenceCache(snapshot.entries, reports, snapshot.rules, continuedPay);
  for (const month of months) {
    const report = reports.find(r => r.period === month) ?? null;
    const review = getReportReview(
      report,
      snapshot.rules,
      snapshot.entries,
      resolveMonthSettlement(snapshot.rules, month, snapshot.settlements, reports, snapshot.entries),
      snapshot.acknowledgements,
      automaticContinuedPay(snapshot.entries, reports, snapshot.rules, month, continuedPay, absences),
      reports
    );
    if (review.reportKey !== reportKey) continue;
    const matched = [...review.employerChecks, ...review.personalChecks].find(
      check => check.key === checkKey && check.status === 'review'
    );
    eligible = !!matched;
    legacyReceiptKey = matched?.legacyAcknowledgedAt ? matched.basisKey : undefined;
    break;
  }
  if (!eligible)
    throw new Error(
      'Dieser Prüfpunkt ist veraltet oder kann nicht quittiert werden. Bitte die Monatsansicht neu laden.'
    );
  if (acknowledged) {
    if (!snapshot.acknowledgements.some(item => item.reportKey === reportKey && item.checkKey === checkKey))
      snapshot.acknowledgements.push(value);
  } else {
    snapshot.acknowledgements = snapshot.acknowledgements.filter(
      item => item.reportKey !== reportKey || item.checkKey !== checkKey
    );
    if (legacyReceiptKey) delete continuedPay.acknowledgements[legacyReceiptKey];
  }
}

export function saveSettlement(snapshot: Snapshot, value: Settlement) {
  snapshot.settlements = snapshot.settlements.filter(v => v.month !== value.month);
  snapshot.settlements.push(value);
  snapshot.settlements.sort((a, b) => a.month.localeCompare(b.month));
}

export function getSettlement(snapshot: Snapshot, month: string): Settlement {
  return snapshot.settlements.find(v => v.month === month) ?? emptySettlement(month);
}

/** Full monthly settlement from form fields. An explicit `openingHoursEntered` wins over field presence. */
export function validateSettlement(form: FormData): Settlement {
  if (form.has('openingHoursEntered') && !['true', 'false'].includes(String(form.get('openingHoursEntered'))))
    throw new Error('Ungültige Angabe zum Anfangsstand.');
  const month = String(form.get('month'));
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Ungültiger Monat.');
  const num = (key: string) => {
    const raw = String(form.get(key) ?? '').trim();
    if (!raw) return null;
    const n = Number(raw.replace(',', '.'));
    if (!Number.isFinite(n) || Math.abs(n) > 1000000) throw new Error('Bitte gültige Zahlen eingeben.');
    return n;
  };
  const value = {
    month,
    recordedHours: num('recordedHours'),
    recordedBalance: num('recordedBalance'),
    paidBonus: num('paidBonus'),
    adjustmentHours: num('adjustmentHours') ?? 0,
    openingHours: num('openingHours') ?? 0,
    openingHoursEntered: form.has('openingHoursEntered')
      ? form.get('openingHoursEntered') === 'true'
      : String(form.get('openingHours') ?? '').trim() !== '',
    targetHours: num('targetHours'),
    overtimeHours: num('overtimeHours') ?? 0,
    overtimePaidHours: num('overtimePaidHours') ?? 0,
    extraPay: num('extraPay') ?? 0,
    note: String(form.get('note') || '').slice(0, 2000)
  };
  if ([value.overtimeHours, value.overtimePaidHours, value.targetHours ?? 0].some(v => v < 0))
    throw new Error('Sollzeit und Überstunden dürfen nicht negativ sein.');
  return value;
}

function berlinMonthOffset(months: number, now = new Date()) {
  const [year, month] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit'
  })
    .format(now)
    .split('-')
    .map(Number);
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 7);
}

export function workspaceMonths(snapshot: Snapshot): string[] {
  return [
    ...new Set([
      ...continuedPayMonths(snapshot.continuedPay),
      ...snapshot.reports.map(v => v.report.period),
      ...snapshot.pendingReports.map(v => v.report.period),
      ...snapshot.pendingEntryImports.flatMap(value => value.preview.entries.map(entry => entry.date.slice(0, 7))),
      ...snapshot.entries.map(e => e.date.slice(0, 7)),
      ...snapshot.settlements.map(v => v.month)
    ])
  ]
    .sort()
    .reverse();
}

/** All data the page needs for one month. `url` supplies `?month=` and `?tab=`. */
export function buildPage(snapshot: Snapshot, url: URL): WorkspaceData {
  const months = workspaceMonths(snapshot);
  // Without data, suggest the month before last: reports are usually printed weeks after the month ends.
  const suggested = berlinMonthOffset(-2);
  const query = url.searchParams.get('month') || months[0] || suggested;
  const month = /^20\d{2}-(0[1-9]|1[0-2])$/.test(query) ? query : suggested;
  const reports = latestReports(snapshot),
    report = reports.find(value => value.period === month) ?? null;
  const settlement = resolveMonthSettlement(snapshot.rules, month, snapshot.settlements, reports, snapshot.entries);
  const sickness = automaticContinuedPay(snapshot.entries, reports, snapshot.rules, month, snapshot.continuedPay);
  const review =
    report || sickness
      ? getReportReview(
          report,
          snapshot.rules,
          snapshot.entries,
          settlement,
          snapshot.acknowledgements,
          sickness,
          reports
        )
      : undefined;
  const reviewMonths = getReviewMonths({
    reports,
    rules: snapshot.rules,
    entries: snapshot.entries,
    settlements: snapshot.settlements,
    acknowledgements: snapshot.acknowledgements,
    pendingReports: snapshot.pendingReports,
    pendingEntryImports: snapshot.pendingEntryImports,
    continuedPay: snapshot.continuedPay
  });
  return {
    entries: snapshot.entries,
    rules: snapshot.rules,
    settlement,
    settlements: snapshot.settlements,
    initialTab: url.searchParams.get('tab') === 'Monat' ? 'Monat' : 'Übersicht',
    month,
    months,
    report,
    pendingReports: snapshot.pendingReports,
    pendingEntryImports: snapshot.pendingEntryImports,
    review,
    reviewMonths,
    continuedPay: snapshot.continuedPay,
    reports
  };
}

export function exportSnapshot(snapshot: Snapshot) {
  const { nextId: _nextId, schemaVersion: _schemaVersion, ...data } = snapshot;
  return { ...data, exportedAt: new Date().toISOString() };
}

export type RestoreResult = {
  inserted: number;
  duplicates: number;
  addedReports: number;
  addedPendingReports: number;
  addedPendingEntryImports: number;
  addedReviewAcknowledgements: number;
};

/** Validate a JSON backup from either build before anything is written. */
export function parseBackup(text: string) {
  const raw = JSON.parse(text);
  const invalid = () => new Error('Keine gültige Zeitklar-Sicherung.');
  if (
    !raw ||
    raw.version !== 1 ||
    !Array.isArray(raw.entries) ||
    !Array.isArray(raw.reports) ||
    !Array.isArray(raw.settlements) ||
    raw.entries.length > 100000 ||
    raw.reports.length > 2000 ||
    raw.settlements.length > 1200
  )
    throw invalid();
  for (const key of ['pendingReports', 'pendingEntryImports'] as const)
    if (raw[key] !== undefined && (!Array.isArray(raw[key]) || raw[key].length > 2000)) throw invalid();
  if (
    raw.acknowledgements !== undefined &&
    (!Array.isArray(raw.acknowledgements) || raw.acknowledgements.length > 200000)
  )
    throw invalid();
  const timestamp = (value: unknown, message: string) => {
    if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) throw new Error(message);
    return value;
  };
  return {
    rules: validateRules(migrateRules(raw.rules)),
    entries: raw.entries.map(validateEntry) as Entry[],
    reports: raw.reports.map((v: { report: unknown }) => validateReport(v?.report)) as TimeReport[],
    pendingReports: (raw.pendingReports ?? []).map((v: PendingReport) => ({
      report: validateReport(v?.report),
      createdAt: timestamp(v?.createdAt, 'Ungültiger Zeitpunkt im ungeprüften Zeitnachweis.')
    })),
    pendingEntryImports: (raw.pendingEntryImports ?? []).map((v: PendingEntryImport) => ({
      preview: validateEntryPreview(v?.preview),
      createdAt: timestamp(v?.createdAt, 'Ungültiger Zeitpunkt im ungeprüften Import.')
    })),
    acknowledgements: (raw.acknowledgements ?? []).map(validateReviewAcknowledgement) as ReviewAcknowledgement[],
    continuedPay: validateContinuedPay(raw.continuedPay),
    settlements: raw.settlements.map((v: Settlement) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(v ?? {})) form.set(key, value === null ? '' : String(value));
      return validateSettlement(form);
    }) as Settlement[]
  };
}

/** Additive merge: existing entries, profile and month settings win; new items are added. */
export function restoreBackup(snapshot: Snapshot, backup: ReturnType<typeof parseBackup>): RestoreResult {
  const saved = addEntries(snapshot, backup.entries, 'Sicherungsimport');
  let addedReports = 0,
    addedPendingReports = 0,
    addedPendingEntryImports = 0,
    addedReviewAcknowledgements = 0;
  for (const r of backup.reports) if (addReport(snapshot, r)) addedReports++;
  for (const r of backup.pendingReports) if (addPendingReport(snapshot, r.report, r.createdAt)) addedPendingReports++;
  for (const value of backup.pendingEntryImports)
    if (addPendingEntryImport(snapshot, value.preview, value.createdAt)) addedPendingEntryImports++;
  const savedAcknowledgements = new Set(snapshot.acknowledgements.map(value => `${value.reportKey}/${value.checkKey}`));
  for (const value of backup.acknowledgements) {
    const key = `${value.reportKey}/${value.checkKey}`;
    if (!savedAcknowledgements.has(key)) {
      snapshot.acknowledgements.push(value);
      savedAcknowledgements.add(key);
      addedReviewAcknowledgements++;
    }
  }
  // Existing profile and month adjustments win when merging into a populated workspace.
  if (!snapshot.rules.confirmed) snapshot.rules = backup.rules;
  for (const value of backup.settlements)
    if (validMonth(value.month) && !snapshot.settlements.some(v => v.month === value.month))
      snapshot.settlements.push(value);
  snapshot.continuedPay = mergeContinuedPay(snapshot.continuedPay, backup.continuedPay);
  return { ...saved, addedReports, addedPendingReports, addedPendingEntryImports, addedReviewAcknowledgements };
}

export const restoreMessage = (result: RestoreResult) =>
  `${result.inserted} eigene Einträge und ${result.addedReports} Nachweise hinzugefügt. Vorhandene Monatsabgleiche bleiben erhalten.`;

/** Whether a month still has an unconfirmed report or own-time import. */
export const monthHasPending = (data: Pick<WorkspaceData, 'pendingReports' | 'pendingEntryImports'>, month: string) =>
  data.pendingReports.some(item => item.report.period === month) ||
  data.pendingEntryImports.some(item => item.preview.entries.some(entry => entry.date.startsWith(month + '-')));
