import { rulesAt, type Rules } from './model';
import type { AuditCheck, ReportDay, TimeReport } from './report';
import { effectiveHolidays } from './holidays';
import { hasPlannedFree, isSickReportDay, isVacationReportDay } from './absence';

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const show = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const present = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const labels = {
  holidayBalance: 'Freizeitkonto Feiertagsarb',
  holidayTimeOffHours: 'TV-Ä/TV-N:Freizeitausgl.FT',
  holidayPaidHours: 'Abzgl.bez.FT-Std. Monat-4'
};

/** Read older saved statements too; their raw text already contains these movements. */
function reportedValue(report: TimeReport, key: keyof typeof labels): number | null {
  if (present(report.totals[key])) return report.totals[key];
  const label = labels[key]
    .split(/\s+/)
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  const pattern = new RegExp(`(?:^|\\s)${label}\\s+(-?\\d+(?:\\.\\d{3})*,\\d+-?)?(?=\\s|$)`);
  for (const line of report.rawText.split(/\r?\n/)) {
    const match = line.replaceAll('|', ' ').match(pattern);
    if (!match) continue;
    if (!match[1]) return 0;
    const value = match[1],
      negative = value.startsWith('-') || value.endsWith('-');
    return Number(value.replaceAll('-', '').replaceAll('.', '').replace(',', '.')) * (negative ? -1 : 1);
  }
  return null;
}
const source = (day: ReportDay) => [day.label, ...day.spans.map(s => s.label)].join(' ');
const isHolidayTimeOff = (day: ReportDay) => hasPlannedFree(source(day)) && /\bFT\b|feiertag/i.test(source(day));

/** Reconcile the time account, independently of monetary holiday supplements. */
export function holidayAccountCheck(
  report: TimeReport,
  timeline: Rules,
  reports: TimeReport[] = []
): AuditCheck | null {
  const rules = rulesAt(timeline, report.period);
  const closing = reportedValue(report, 'holidayBalance');
  if (closing === null) return null;
  const notes: string[] = [],
    basis: unknown[] = [];
  let uncertain = false;
  const [year, month] = report.period.split('-').map(Number);
  const priorMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const prior = reports.find(r => r.period === priorMonth);
  const knownOpening = present(report.totals.holidayOpeningBalance)
    ? report.totals.holidayOpeningBalance
    : prior
      ? reportedValue(prior, 'holidayBalance')
      : null;
  const opening = knownOpening ?? 0;
  if (knownOpening === null) {
    uncertain = true;
    notes.push(`Feiertagskonto-Endstand für ${priorMonth} fehlt; Anfangsstand vorläufig 0,00 h.`);
  } else
    notes.push(
      present(report.totals.holidayOpeningBalance)
        ? `Anfangsstand aus dem aktuellen Nachweis: ${show(opening)} h.`
        : `Anfangsstand aus ${priorMonth}: ${show(opening)} h${opening === 0 && prior?.totals.holidayBalance === null ? ' (leeres Kontofeld als 0 h behandelt)' : ''}.`
    );
  basis.push(priorMonth, knownOpening);

  const holidays = new Set(effectiveHolidays(rules, year));
  const worked = report.days.filter(
    d =>
      holidays.has(d.date) &&
      new Date(d.date).getUTCDay() !== 0 &&
      !isSickReportDay(d) &&
      !isVacationReportDay(d) &&
      !hasPlannedFree(source(d)) &&
      ((d.holidayHours ?? 0) > 0 || (d.actualHours ?? 0) > 0)
  );
  const dayHours = round(
    worked.reduce(
      (n, d) => n + (present(d.holidayHours) && d.holidayHours > 0 ? d.holidayHours : (d.actualHours ?? 0)),
      0
    )
  );
  const compensated = report.wageTypes.holiday35,
    paid = report.wageTypes.holiday135 ?? 0;
  const specialHours = round(
    report.days
      .filter(d => ['12-24', '12-31'].includes(d.date.slice(5)) && !holidays.has(d.date))
      .reduce((n, d) => n + (d.holidayHours ?? 0), 0)
  );
  const compensatedHolidays = present(compensated) ? round(Math.max(0, compensated - specialHours)) : null;
  if (specialHours > 0)
    notes.push(
      `${show(specialHours)} h am 24./31. Dezember gehören zum Zeitzuschlag, nicht zum Freizeitkonto für gesetzliche Feiertage.`
    );
  let accrued = dayHours;
  if (present(report.totals.holidayAccruedHours)) accrued = report.totals.holidayAccruedHours;
  else if (compensatedHolidays !== null && Math.abs(dayHours - compensatedHolidays - paid) <= 0.011) {
    accrued = compensatedHolidays;
    if (paid > 0)
      notes.push(`${show(paid)} h mit FT 135 % sind bezahlt und erzeugen keinen zusätzlichen Zeitkonto-Zugang.`);
  } else if (compensatedHolidays !== null && compensatedHolidays > 0) {
    // The 35% wage alone cannot distinguish all holiday and 24/31 December cases.
    accrued = compensatedHolidays;
    uncertain = true;
    notes.push(
      `Zugang vorläufig aus FT 35 %: ${show(accrued)} h; Zuordnung zu den gesetzlichen Werktagsfeiertagen anhand der Tageswerte prüfen.`
    );
  } else if (dayHours > 0 && Math.abs(dayHours - paid) <= 0.011) accrued = 0;
  else if (dayHours > 0) {
    uncertain = true;
    notes.push(
      'Feiertagsarbeit erkannt; Zuordnung zu Freizeitausgleich oder Bezahlung ist in den Lohnarten nicht vollständig ausgewiesen.'
    );
  } else if (report.days.length !== new Date(Date.UTC(year, month, 0)).getUTCDate()) {
    uncertain = true;
    notes.push('Tagesliste unvollständig; nicht erkannte Zugänge sind vorläufig mit 0 h angesetzt.');
  }
  if (worked.length)
    notes.push(
      `Feiertagsarbeit: ${worked.map(d => `${d.date}: ${show(present(d.holidayHours) && d.holidayHours > 0 ? d.holidayHours : (d.actualHours ?? 0))} h`).join('; ')}. ${show(accrued)} h Zugang mit Freizeitausgleich.`
    );
  if (worked.some(d => (d.standbyHours ?? 0) > 0 || /\bBD[-\s]/i.test(source(d)))) {
    uncertain = true;
    notes.push('Regeldienst und Bereitschaftsdienst am Feiertag getrennt auf Kontenzuordnung prüfen.');
  }
  basis.push(
    worked.map(d => [d.date, d.actualHours, d.holidayHours, d.standbyHours]),
    compensated,
    paid,
    specialHours,
    accrued
  );

  const timeOffDays = report.days.filter(isHolidayTimeOff);
  const dailyTimeOff = round(timeOffDays.reduce((n, d) => n + (d.actualHours ?? d.plannedHours ?? 0), 0));
  const reportedTimeOff = reportedValue(report, 'holidayTimeOffHours');
  const taken = Math.abs(reportedTimeOff ?? dailyTimeOff);
  if (reportedTimeOff === null && !timeOffDays.length) {
    uncertain = true;
    notes.push(
      'Feiertags-Freizeitausgleich fehlt als Monatssumme; aus erkannten FT-FZA-Tagen vorläufig 0 h angesetzt.'
    );
  }
  if (timeOffDays.some(d => d.actualHours === null && d.plannedHours === null)) {
    uncertain = true;
    notes.push('Stundenzahl eines FT-FZA-Tages fehlt.');
  }
  if (taken > 0) {
    notes.push(
      `Abbau für Feiertags-Freizeitausgleich: ${show(taken)} h${timeOffDays.length ? ` (${timeOffDays.map(d => d.date).join(', ')})` : ''}.`
    );
    if (reportedTimeOff !== null && Math.abs(reportedTimeOff - dailyTimeOff) > 0.011) {
      uncertain = true;
      notes.push('Ausgewiesene FT-Freizeitausgleichssumme und erkannte FT-FZA-Tage sind nicht vollständig zugeordnet.');
    }
  }
  const paidOut = Math.abs(reportedValue(report, 'holidayPaidHours') ?? 0);
  if (reportedValue(report, 'holidayPaidHours') === null) {
    uncertain = true;
    notes.push('Ausgezahlte FT-Stunden fehlen als Monatssumme; vorläufig 0 h angesetzt.');
  }
  if (paidOut > 0) notes.push(`Abzug ausgezahlter FT-Stunden aus Monat −4: ${show(paidOut)} h.`);
  const correction = report.totals.holidayAdjustmentHours ?? 0;
  if (correction !== 0) notes.push(`Ausgewiesene Kontokorrektur: ${show(correction)} h.`);
  basis.push(
    taken,
    paidOut,
    correction,
    timeOffDays.map(d => [d.date, d.actualHours, d.plannedHours])
  );
  const expected = round(opening + accrued - taken - paidOut + correction);
  const formula = `${show(opening)} + ${show(accrued)} − ${show(taken)} − ${show(paidOut)}${correction !== 0 ? ` + ${show(correction)}` : ''} = ${show(expected)} h. Anfangsstand + Feiertags-Zugang − genommener FT-Freizeitausgleich − ausgezahlte FT-Stunden${correction !== 0 ? ' + Kontokorrektur' : ''}.`;
  return {
    title: 'Freizeitkonto Feiertagsarbeit',
    expected,
    reported: closing,
    unit: 'h',
    status: uncertain ? 'review' : Math.abs(expected - closing) <= 0.011 ? 'ok' : 'difference',
    detail: [formula, ...notes, 'FT-Zeitzuschläge in Euro werden separat in der Vergütung berechnet.'].join(' '),
    basisKey: JSON.stringify(basis),
    presentation: {
      facts: [
        `${show(opening)} + ${show(accrued)} − ${show(taken)} − ${show(paidOut)}${correction !== 0 ? ` + ${show(correction)}` : ''} = ${show(expected)} h.`,
        `Anfangsstand + Feiertags-Zugang − genommener FT-Freizeitausgleich − ausgezahlte FT-Stunden${correction !== 0 ? ' + Kontokorrektur' : ''}.`,
        ...notes.filter(
          note =>
            note !==
            'Feiertags-Freizeitausgleich fehlt als Monatssumme; aus erkannten FT-FZA-Tagen vorläufig 0 h angesetzt.'
        )
      ],
      info: 'FT-Zeitzuschläge in Euro werden separat in der Vergütung berechnet.'
    }
  };
}
