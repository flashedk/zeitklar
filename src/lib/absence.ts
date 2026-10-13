import { rulesAt, dailyTargetHours, type Entry, type Rules } from './model';
import type { ReportDay } from './report';
import { effectiveHolidays } from './holidays';

export const hasSickness = (text: string) => /\bkrank(?:heit)?\b|arbeitsunf[aä]h/i.test(text);
export const hasVacation = (text: string) =>
  /\b(?:urlaub|erholungsurlaub|zusatzurlaub)\b/i.test(text) &&
  !/\b(?:sonderurlaub|unbezahl\w*)\b|ohne\s+bez[uü]ge/i.test(text);
export const hasPlannedFree = (text: string) => /\bFZA\b|freizeitausgleich|geplant(?:es|er|e)?\s+frei/i.test(text);
export function isSickReportDay(day: ReportDay): boolean {
  return hasSickness([day.label, ...day.rawLines, ...day.spans.map(s => s.label)].join(' '));
}
export function isVacationReportDay(day: ReportDay): boolean {
  return !isSickReportDay(day) && hasVacation([day.label, ...day.rawLines, ...day.spans.map(s => s.label)].join(' '));
}
export function sickReportDayEligible(day: ReportDay): boolean {
  // Continuation lines may carry the sickness label, while the original row carries the plan.
  if (hasPlannedFree(day.label) || day.spans.some(s => hasPlannedFree(s.label))) return false;
  return (day.plannedHours ?? 0) > 0 || (day.actualHours ?? 0) > 0;
}
export function sickEntryEligible(entry: Entry, timeline: Rules): boolean {
  const rules = rulesAt(timeline, entry.date);
  if (entry.meta?.sickPayEligible !== undefined) return entry.meta.sickPayEligible;
  return (
    !hasPlannedFree(entry.note) &&
    dailyTargetHours(rules, entry.date) > 0 &&
    !effectiveHolidays(rules, Number(entry.date.slice(0, 4))).includes(entry.date) &&
    !(rules.tariff && ['12-24', '12-31'].includes(entry.date.slice(5)))
  );
}
export function vacationEntryEligible(entry: Entry, rules: Rules): boolean {
  if (entry.meta?.vacationPayEligible !== undefined) return entry.meta.vacationPayEligible;
  return (
    sickEntryEligible({ ...entry, meta: { ...entry.meta, sickPayEligible: undefined } }, rules) &&
    !/\b(?:sonderurlaub|unbezahl\w*)\b|ohne\s+bez[uü]ge/i.test(entry.note)
  );
}
