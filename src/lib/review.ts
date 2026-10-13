import { resolveMonthSettlement } from './balance';
import { auditReport, comparePersonalEntries } from './audit';
import { type Entry, type Rules, type Settlement } from './model';
import type { AuditCheck, PendingReport, TimeReport } from './report';
import { reportSignature } from './report-signature';
import type { PendingEntryImport } from './upload';
import { continuedPayMonths, emptyContinuedPay, type ContinuedPay } from './continued-pay';
import { AbsenceCache, automaticContinuedPay, continuedAbsenceMonths, type SicknessAudit } from './sickness';

export type ReviewAcknowledgement = { reportKey: string; checkKey: string; acknowledgedAt: string };
export type ReviewCheck = AuditCheck & { key: string; acknowledgedAt: string | null };
export type ReviewContext = {
  reportKey: string;
  employerChecks: ReviewCheck[];
  personalChecks: ReviewCheck[];
  openCount: number;
};

/** Compact, synchronous 128-bit checksum for content identity, never an authorization token. */
function fingerprint(value: string): string {
  const states = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const multipliers = [0x01000193, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f];
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    for (let stream = 0; stream < states.length; stream++)
      states[stream] = Math.imul(states[stream] ^ code, multipliers[stream]);
  }
  return states
    .map(state => {
      state = Math.imul(state ^ (state >>> 16), 0x85ebca6b);
      state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35);
      return ((state ^ (state >>> 16)) >>> 0).toString(16).padStart(8, '0');
    })
    .join('');
}

/** PDF/TXT formatting and filenames do not create a new statement version. */
export function reportReviewKey(report: TimeReport): string {
  return 'r1_' + fingerprint(reportSignature(report));
}

/** A changed value, status, unit or explanatory attribution requires a new acknowledgement. */
export function reviewCheckKey(source: 'employer' | 'personal', check: AuditCheck): string {
  if (source !== 'employer' && source !== 'personal') throw new Error('Ungültige Herkunft des Prüfpunkts.');
  const values: unknown[] = [
    source,
    check.title,
    check.status,
    check.expected,
    check.reported,
    check.unit,
    check.detail
  ];
  if (check.basisKey !== undefined) values.push(check.basisKey);
  return 'c1_' + fingerprint(JSON.stringify(values));
}

export function validateAcknowledgement(raw: unknown): ReviewAcknowledgement {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Ungültige Quittierung.');
  const value = raw as ReviewAcknowledgement;
  if (
    typeof value.reportKey !== 'string' ||
    !/^r1_[0-9a-f]{32}$/.test(value.reportKey) ||
    typeof value.checkKey !== 'string' ||
    !/^c1_[0-9a-f]{32}$/.test(value.checkKey)
  )
    throw new Error('Ungültiger Nachweis- oder Prüfschlüssel.');
  if (
    typeof value.acknowledgedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.acknowledgedAt) ||
    Number.isNaN(Date.parse(value.acknowledgedAt)) ||
    new Date(value.acknowledgedAt).toISOString() !== value.acknowledgedAt
  )
    throw new Error('Ungültiger Quittierungszeitpunkt.');
  return { reportKey: value.reportKey, checkKey: value.checkKey, acknowledgedAt: value.acknowledgedAt };
}
export const validateReviewAcknowledgement = validateAcknowledgement;

export function getReportReview(
  report: TimeReport | null,
  rules: Rules,
  entries: Entry[],
  settlement: Settlement,
  acknowledgements: ReviewAcknowledgement[] = [],
  sickness: SicknessAudit | null = null,
  reports: TimeReport[] = []
): ReviewContext {
  const reportKey = reportReviewKey(
    report ?? {
      period: settlement.month,
      printedAt: '',
      filename: '',
      days: [],
      totals: {},
      wageTypes: {},
      transfers: [],
      issues: [],
      warnings: [],
      rawText: ''
    }
  );
  const acknowledged = new Map<string, string>();
  for (const raw of acknowledgements) {
    // Persisted data is validated on write; tolerate unusable legacy data without hiding checks.
    let value: ReviewAcknowledgement;
    try {
      value = validateAcknowledgement(raw);
    } catch {
      continue;
    }
    if (value.reportKey !== reportKey) continue;
    if ((acknowledged.get(value.checkKey) ?? '') < value.acknowledgedAt)
      acknowledged.set(value.checkKey, value.acknowledgedAt);
  }
  const attach = (source: 'employer' | 'personal', checks: AuditCheck[]): ReviewCheck[] =>
    checks.map(check => {
      const key = reviewCheckKey(source, check);
      return {
        ...check,
        key,
        acknowledgedAt: check.status === 'review' ? (acknowledged.get(key) ?? check.legacyAcknowledgedAt ?? null) : null
      };
    });
  const employerChecks = attach('employer', [
    ...(report ? auditReport(report, rules, settlement, reports).checks : []),
    ...(sickness?.checks ?? [])
  ]);
  const personalChecks = attach('personal', report ? comparePersonalEntries(report, entries) : []);
  const openCount = [...employerChecks, ...personalChecks].filter(
    check => check.status === 'difference' || (check.status === 'review' && check.acknowledgedAt === null)
  ).length;
  return { reportKey, employerChecks, personalChecks, openCount };
}

export type ReviewWorkspace = {
  reports: TimeReport[];
  rules: Rules;
  entries: Entry[];
  settlements?: Settlement[];
  acknowledgements?: ReviewAcknowledgement[];
  pendingReports?: PendingReport[];
  pendingEntryImports?: PendingEntryImport[];
  continuedPay?: ContinuedPay;
};

/** Saved reports are supplied in insertion order; only the latest version in each month counts. */
export function getReviewMonths(workspace: ReviewWorkspace): string[] {
  const latestReports = new Map<string, TimeReport>();
  for (const report of workspace.reports) latestReports.set(report.period, report);
  const months = new Set<string>();
  for (const pending of workspace.pendingReports ?? []) months.add(pending.report.period);
  for (const pending of workspace.pendingEntryImports ?? [])
    for (const entry of pending.preview.entries) months.add(entry.date.slice(0, 7));
  const reports = [...latestReports.values()],
    continuedPay = workspace.continuedPay ?? emptyContinuedPay();
  const candidates = new Set([
    ...latestReports.keys(),
    ...continuedAbsenceMonths(workspace.entries, reports, workspace.rules),
    ...continuedPayMonths(continuedPay)
  ]);
  // Absence blocks and reference amounts are shared by all evaluated months.
  const absences = new AbsenceCache(workspace.entries, reports, workspace.rules, continuedPay);
  for (const month of candidates) {
    const report = latestReports.get(month) ?? null;
    const sickness = automaticContinuedPay(workspace.entries, reports, workspace.rules, month, continuedPay, absences);
    const context = getReportReview(
      report,
      workspace.rules,
      workspace.entries,
      resolveMonthSettlement(workspace.rules, month, workspace.settlements ?? [], reports, workspace.entries),
      workspace.acknowledgements ?? [],
      sickness,
      reports
    );
    if (context.openCount > 0) months.add(month);
  }
  return [...months].sort().reverse();
}
