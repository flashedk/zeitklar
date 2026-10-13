import type { TimeReport } from './report';
import { isSickReportDay, isVacationReportDay } from './absence';
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
}
/** Formatting, source filename and object insertion order do not identify a new employer statement. */
export function reportSignature(report: TimeReport): string {
  const fields = {
    period: report.period,
    printedAt: report.printedAt,
    days: report.days.map(({ rawLines, spans, ...day }) => ({
      ...day,
      ...(isSickReportDay({ ...day, rawLines, spans }) ? { sick: true } : {}),
      ...(isVacationReportDay({ ...day, rawLines, spans }) ? { vacation: true } : {}),
      spans: spans.map(({ raw, ...span }) => span)
    })),
    totals: report.totals,
    wageTypes: report.wageTypes,
    transfers: report.transfers,
    issues: report.issues
  };
  return JSON.stringify(canonical(fields));
}
