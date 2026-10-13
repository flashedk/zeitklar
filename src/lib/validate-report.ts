import { validDate, minute } from './model';
import type { TimeReport } from './report';
export function validateReport(raw: unknown): TimeReport {
  const r = raw as TimeReport;
  const string = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
  const number = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000000);
  const record = (v: unknown) =>
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).length <= 200 &&
    Object.entries(v).every(([k, n]) => k.length < 200 && number(n));
  const invalid = () => {
    throw new Error('Der Zeitnachweis enthält ungültige Daten. Bitte die Datei erneut einlesen.');
  };
  if (
    !r ||
    !/^20\d{2}-(0[1-9]|1[0-2])$/.test(r.period) ||
    !string(r.printedAt, 30) ||
    (r.printedAt && !validDate(r.printedAt)) ||
    !string(r.filename, 200) ||
    !string(r.rawText, 500000)
  )
    invalid();
  if (
    !Array.isArray(r.days) ||
    r.days.length > 31 ||
    !record(r.totals) ||
    !record(r.wageTypes) ||
    !Array.isArray(r.warnings) ||
    r.warnings.length > 500 ||
    !r.warnings.every(w => string(w, 2000))
  )
    invalid();
  const dates = new Set<string>();
  for (const day of r.days) {
    if (!validDate(day.date) || !day.date.startsWith(r.period) || dates.has(day.date) || !string(day.label, 500))
      invalid();
    dates.add(day.date);
    for (const key of [
      'plannedHours',
      'actualHours',
      'overtimeHours',
      'standbyHours',
      'standbyWeightedHours',
      'standbyCount',
      'nightHours',
      'saturdayHours',
      'sundayHours',
      'holidayHours'
    ] as const)
      if (!number(day[key])) invalid();
    if (
      !Array.isArray(day.spans) ||
      day.spans.length > 30 ||
      !Array.isArray(day.rawLines) ||
      day.rawLines.length > 100 ||
      !day.rawLines.every(v => string(v, 2000))
    )
      invalid();
    for (const s of day.spans) {
      try {
        minute(s.start);
      } catch {
        throw new Error(
          `${day.date}: Ungültiger Beginn im Zeitnachweis. Erwartet wird eine Uhrzeit von 00:00 bis 23:59.`
        );
      }
      // DPL uses 24:00 for midnight at the END of the source date.
      // Retain that notation instead of changing the original span or raw text.
      try {
        if (s.end !== '24:00') minute(s.end);
      } catch {
        throw new Error(
          `${day.date}: Ungültige Endzeit im Zeitnachweis. Erwartet wird eine Uhrzeit von 00:00 bis 23:59 oder 24:00 für das Tagesende.`
        );
      }
      if (!['work', 'standby', 'unknown'].includes(s.kind) || !string(s.label, 500) || !string(s.raw, 2000)) invalid();
    }
  }
  if (
    !Array.isArray(r.transfers) ||
    r.transfers.length > 200 ||
    !r.transfers.every(v => validDate(v.date) && string(v.label, 500) && v.hours !== null && number(v.hours))
  )
    invalid();
  if (
    !Array.isArray(r.issues) ||
    r.issues.length > 200 ||
    !r.issues.every(v => validDate(v.date) && string(v.message, 2000))
  )
    invalid();
  return r;
}
