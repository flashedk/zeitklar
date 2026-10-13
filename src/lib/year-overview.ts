import { auditReport } from './audit';
import { resolveMonthSettlement } from './balance';
import { calculate } from './calculate';
import { AbsenceCache, automaticContinuedPay, compensationTotal } from './sickness';
import { emptyContinuedPay } from './continued-pay';
import type { WorkspaceData } from './workspace';
import { durationMinutes, isDuty, minute, type Entry } from './model';

export const shortMonths = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const payCategories = [
  { key: 'night', label: 'Nachtzuschläge', color: '#244d3c' },
  { key: 'weekend', label: 'Samstag / Sonntag', color: '#789565' },
  { key: 'holiday', label: 'Feiertagszuschläge', color: '#bdce94' },
  { key: 'standby', label: 'Bereitschaftsdienst', color: '#547f91' },
  { key: 'oncall', label: 'Rufbereitschaft / Einsätze', color: '#91b4c1' },
  { key: 'overtime', label: 'Überstundenvergütung', color: '#d7ac62' },
  { key: 'continued', label: 'Entgeltfortzahlung', color: '#b78979' },
  { key: 'other', label: 'Weitere Vergütung', color: '#9a92b2' }
] as const;
type PayKey = (typeof payCategories)[number]['key'];
export type YearMonth = {
  month: string;
  label: string;
  source: 'report' | 'personal' | 'missing';
  balance: number | null;
  pay: number | null;
  standby: number | null;
  oncall: number | null;
  overtime: number | null;
  components: Record<PayKey, number>;
};
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
export function mean(values: (number | null)[]): number | null {
  const known = values.filter(finite);
  return known.length ? round(known.reduce((sum, n) => sum + n, 0) / known.length) : null;
}
export function countDuties(entries: Entry[], month: string, kind: Entry['kind']) {
  return new Set(
    entries
      .filter(e => e.kind === kind && (e.meta?.dutyDate ?? e.date).startsWith(month + '-'))
      .map(e => (e.meta?.dutyDate ? `${e.meta.dutyDate}/${e.meta.dutyName ?? kind}` : `${e.date}/${e.start}/${e.end}`))
  ).size;
}
function category(label: string): PayKey {
  if (/Nacht/i.test(label)) return 'night';
  if (/Samstag|Sonntag/i.test(label)) return 'weekend';
  if (/Feiertag/i.test(label)) return 'holiday';
  if (/Bereitschaftsdienst/i.test(label)) return 'standby';
  if (/Überstunden/i.test(label)) return 'overtime';
  return 'other';
}

export type YearOverviewInput = Pick<WorkspaceData, 'entries' | 'rules' | 'report' | 'settlement' | 'month'> &
  Partial<Pick<WorkspaceData, 'reports' | 'settlements' | 'continuedPay' | 'months'>>;

/** Reuse monthly calculations; unknown months and amounts remain unknown in annual averages. */
export function yearOverview(data: YearOverviewInput, year: number) {
  const reports = data.reports ?? (data.report ? [data.report] : []);
  const settlements = data.settlements ?? [data.settlement];
  const continuedPay = data.continuedPay ?? emptyContinuedPay();
  const absences = new AbsenceCache(data.entries, reports, data.rules, continuedPay);
  const months: YearMonth[] = shortMonths.map((label, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`;
    const report = reports.find(r => r.period === month);
    const settlement = resolveMonthSettlement(data.rules, month, settlements, reports, data.entries);
    const sickness = automaticContinuedPay(data.entries, reports, data.rules, month, continuedPay, absences);
    const hasEntries = data.entries.some(
      e =>
        e.date.startsWith(month + '-') ||
        e.meta?.dutyDate?.startsWith(month + '-') ||
        (isDuty(e) &&
          e.date < month + '-01' &&
          Date.parse(e.date) + (minute(e.start) + durationMinutes(e)) * 60000 > Date.parse(month + '-01'))
    );
    const row: YearMonth = {
      month,
      label,
      source: report ? 'report' : hasEntries || sickness ? 'personal' : 'missing',
      balance: null,
      pay: null,
      standby: null,
      oncall: null,
      overtime: null,
      components: Object.fromEntries(payCategories.map(c => [c.key, 0])) as Record<PayKey, number>
    };
    if (row.source === 'missing') return row;
    if (report) {
      const audit = auditReport(report, data.rules, settlement, reports);
      row.balance = finite(report.totals.closingBalance)
        ? report.totals.closingBalance
        : audit.hoursSummary.computedClosingBalance;
      row.pay = compensationTotal(audit, sickness);
      row.overtime = audit.hoursSummary.reportedOvertimeHours;
      const dailyCounts = report.days.map(d => d.standbyCount).filter(finite);
      row.standby = finite(report.totals.bdCount)
        ? report.totals.bdCount
        : dailyCounts.length
          ? dailyCounts.reduce((a, b) => a + b, 0)
          : null;
      // The report schema has no reliable monthly Rufbereitschaft count.
      for (const line of audit.payLines) row.components[category(line.label)] += line.amount;
    } else {
      const result = calculate(data.entries, data.rules, month, settlement);
      row.balance = result.rows.length ? result.balance : null;
      row.pay =
        result.payAvailable && sickness?.amount !== null ? round(result.expectedPay + (sickness?.amount ?? 0)) : null;
      row.standby = countDuties(data.entries, month, 'standby');
      row.oncall = countDuties(data.entries, month, 'oncall');
      // A positive account delta alone does not establish overtime.
      for (const item of result.rows) {
        row.components.night += item.timeSupplements.night;
        row.components.weekend += item.timeSupplements.weekend;
        row.components.holiday += item.timeSupplements.holiday;
        row.components[
          item.kind === 'standby' ? 'standby' : ['oncall', 'callout'].includes(item.kind) ? 'oncall' : 'other'
        ] += item.dutyPay;
      }
      row.components.overtime += result.overtimeBonus;
    }
    row.components.continued = sickness?.amount ?? 0;
    for (const key of Object.keys(row.components) as PayKey[]) row.components[key] = round(row.components[key]);
    return row;
  });
  const payMonths = months.filter(m => m.pay !== null);
  const components = payCategories
    .map(c => ({
      ...c,
      amount: round(payMonths.reduce((sum, m) => sum + m.components[c.key], 0)),
      average: payMonths.length
        ? round(payMonths.reduce((sum, m) => sum + m.components[c.key], 0) / payMonths.length)
        : 0
    }))
    .filter(c => c.amount > 0);
  const totalPay = payMonths.length ? round(payMonths.reduce((sum, m) => sum + m.pay!, 0)) : null;
  return {
    year,
    months,
    components,
    totalPay,
    payMonthCount: payMonths.length,
    monthCount: months.filter(m => m.source !== 'missing').length,
    averagePay: mean(months.map(m => m.pay)),
    averageStandby: mean(months.map(m => m.standby)),
    averageOncall: mean(months.map(m => m.oncall)),
    averageOvertime: mean(months.map(m => m.overtime))
  };
}
