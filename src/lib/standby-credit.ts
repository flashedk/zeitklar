import type { ReportDay, TimeReport } from './report';

export type StandbyCompensation = 'fza' | 'paid' | 'unknown';
function compensationMarkers(day: ReportDay): ('fza' | 'paid')[] {
  const source = [day.label, ...day.rawLines, ...day.spans.flatMap(span => [span.label, span.raw])].join(' ');
  return [...source.matchAll(/\bBD[-_. ]?St\.?\s*(?:III|II|I)\s*[-_. ](FZA|bez(?:ahlt)?)\b/gi)].map(match =>
    match[1].toLowerCase() === 'fza' ? 'fza' : 'paid'
  );
}
export function standbyCompensation(day: ReportDay): StandbyCompensation {
  const markers = new Set(compensationMarkers(day));
  return markers.size === 1 ? [...markers][0] : 'unknown';
}

export type StandbyTimeCredit = { hours: number; days: { date: string; hours: number }[]; unresolvedDates: string[] };

/** DPL FZA duties credit their reported weighted hours separately from regular Istzeit. */
export function standbyTimeCredit(report: TimeReport, category: 'fza' | 'paid' = 'fza'): StandbyTimeCredit {
  const days: StandbyTimeCredit['days'] = [],
    unresolvedDates: string[] = [];
  for (const day of report.days) {
    const markers = compensationMarkers(day);
    if (!markers.includes(category)) continue;
    if (day.standbyHours === 0 && day.standbyWeightedHours === null) continue;
    // Daily totals cannot separate paid and FZA duties that share the same source day.
    if (
      markers.some(marker => marker !== category) ||
      !Number.isFinite(day.standbyWeightedHours) ||
      day.standbyWeightedHours! < 0
    ) {
      unresolvedDates.push(day.date);
      continue;
    }
    days.push({ date: day.date, hours: day.standbyWeightedHours! });
  }
  return { hours: Math.round(days.reduce((sum, day) => sum + day.hours, 0) * 100) / 100, days, unresolvedDates };
}
