/** Imported employer statements remain separate from independently calculated work entries. */
import type { StandbyTimeCredit } from './standby-credit';
export type PendingReport = { id: number; report: TimeReport; createdAt: string };
/** Employer endpoints may use 24:00 to mean midnight at the end of the source date. */
export type ReportSpan = {
  start: string;
  end: string;
  label: string;
  kind: 'work' | 'standby' | 'unknown';
  raw: string;
};
export type ReportDay = {
  date: string;
  label: string;
  plannedHours: number | null;
  actualHours: number | null;
  overtimeHours: number | null;
  standbyHours: number | null;
  standbyWeightedHours: number | null;
  standbyCount: number | null;
  nightHours: number | null;
  saturdayHours: number | null;
  sundayHours: number | null;
  holidayHours: number | null;
  spans: ReportSpan[];
  rawLines: string[];
};
export type TimeReport = {
  period: string;
  printedAt: string;
  filename: string;
  days: ReportDay[];
  totals: Record<string, number | null>;
  wageTypes: Record<string, number | null>;
  transfers: { date: string; label: string; hours: number }[];
  issues: { date: string; message: string }[];
  warnings: string[];
  rawText: string;
};
export type CheckPresentation = { title?: string; formula?: string; facts?: string[]; info?: string };
export type AuditCheck = {
  title: string;
  status: 'ok' | 'difference' | 'review';
  expected: number | null;
  reported: number | null;
  unit: 'h' | 'EUR' | 'count';
  detail: string;
  presentation?: CheckPresentation;
  bdCategory?: 'fza' | 'paid' | 'unknown';
  basisKey?: string;
  legacyAcknowledgedAt?: string;
};
export type EmployerHoursSummary = {
  actualHours: number;
  contractualTarget: number;
  plannedTarget: number;
  openingBalance: number;
  adjustmentHours: number;
  standbyCredit: StandbyTimeCredit;
  computedClosingBalance: number;
  monthlyDelta: number;
  plannedDelta: number;
  overtimeBasis: number;
  reportedOvertimeHours: number | null;
  assumptions: string[];
  evidence: {
    actualHours: 'report' | 'settlement' | 'days' | 'assumption';
    contractualTarget: 'report' | 'settlement' | 'profile';
    plannedTarget: 'report' | 'days' | 'assumption';
    openingBalance: 'report' | 'settlement' | 'assumption';
    adjustmentHours: 'settlement';
  };
};
export type ReportAudit = {
  checks: AuditCheck[];
  estimatedPay: number | null;
  payAvailable: boolean;
  payLines: {
    label: string;
    hours: number;
    rate: number;
    amount: number;
    basis: string;
    quantityUnit?: 'h' | 'count';
  }[];
  warnings: string[];
  hoursSummary: EmployerHoursSummary;
  information: TimeReport['issues'];
};
