import type { calculate } from './calculate';
import type { Entry } from './model';
import type { ReportAudit, TimeReport } from './report';
import type { SicknessAudit } from './sickness';
import { countDuties } from './year-overview';

const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
function sumKnown(values: (number | null | undefined)[]): number | null {
  const known = values.filter(finite);
  return known.length ? round(known.reduce((sum, n) => sum + n, 0)) : null;
}

/** Statistics share the monthly calculation and preserve unknown report quantities. */
export function monthStatistics(
  month: string,
  entries: Entry[],
  result: ReturnType<typeof calculate>,
  report: TimeReport | null,
  audit: ReportAudit | null,
  sickness: SicknessAudit | null
) {
  const own = result.rows.length > 0;
  const absenceDays = (kind: 'sick' | 'vacation') =>
    (report?.days.length ?? 0) > 0 || own || sickness
      ? (sickness?.lines ?? []).filter(line => line.kind === kind).reduce((sum, line) => sum + line.count, 0)
      : null;
  return {
    delta: report
      ? (report.totals.monthlyBalance ?? audit?.hoursSummary.monthlyDelta ?? null)
      : own
        ? round(result.regular + result.credited - result.target)
        : null,
    standbyCount: report
      ? (report.totals.bdCount ?? sumKnown(report.days.map(day => day.standbyCount)))
      : own
        ? countDuties(entries, month, 'standby')
        : null,
    standbyHours: report
      ? (report.totals.bdHours ?? sumKnown(report.days.map(day => day.standbyHours)))
      : own
        ? round(result.rows.filter(row => row.kind === 'standby').reduce((sum, row) => sum + row.worked, 0))
        : null,
    oncallCount: report ? null : own ? countDuties(entries, month, 'oncall') : null,
    night: report
      ? (report.wageTypes.nightTotal ??
        sumKnown([report.wageTypes.night, report.wageTypes.nightStandby]) ??
        sumKnown(report.days.map(day => day.nightHours)))
      : own
        ? round(result.night)
        : null,
    saturday: report
      ? (report.wageTypes.saturday ?? sumKnown(report.days.map(day => day.saturdayHours)))
      : own
        ? round(result.saturday)
        : null,
    sunday: report
      ? (report.wageTypes.sunday ?? sumKnown(report.days.map(day => day.sundayHours)))
      : own
        ? round(result.sunday)
        : null,
    holiday: report
      ? (sumKnown(report.days.map(day => day.holidayHours)) ??
        sumKnown([report.wageTypes.holiday35, report.wageTypes.holiday135]))
      : own
        ? round(result.holiday)
        : null,
    overtime: report ? (audit?.hoursSummary.reportedOvertimeHours ?? null) : null,
    sickDays: absenceDays('sick'),
    vacationDays: absenceDays('vacation')
  };
}
