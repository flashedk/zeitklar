import { hours } from './calculate';
import type { CheckRow } from './check-groups';
import type { AuditCheck, CheckPresentation, EmployerHoursSummary, TimeReport } from './report';

const known = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
const amount = (n: number) => `${hours(n)} h`;
const cleanInfo = (text: string) =>
  text
    .replace(/; keine unabhängige Anwesenheitsberechnung\./g, '.')
    .replace(/^Freizeitausgleich \/ Zugang zum Zeitkonto\.\s*|^Auszahlung \/ Zugang zum BD-Auszahlungskonto\.\s*/, '');

/** Hide only duplicate successful results; distinct or unresolved comparisons remain actionable. */
export function compactEmployerRows(rows: CheckRow[]): CheckRow[] {
  const night = rows.find(row => row.check.title === 'Nachtstunden: Tageswerte / Lohnart')?.check;
  const paid = rows.find(row => row.check.title === 'BD zur Auszahlung')?.check;
  return rows.filter(({ check }) => {
    if (
      check.title === 'Nachtstunden: regulär + BD' &&
      night &&
      check.status === 'ok' &&
      night.status === 'ok' &&
      known(check.expected) &&
      known(check.reported) &&
      check.expected === night.expected &&
      check.reported === night.reported
    )
      return false;
    if (
      check.title.startsWith('BD-Auszahlung:') &&
      paid &&
      check.status === 'ok' &&
      paid.status === 'ok' &&
      known(check.expected) &&
      known(check.reported) &&
      check.expected === paid.reported &&
      check.reported === paid.reported
    )
      return false;
    return true;
  });
}

/** Presentation stays separate from the calculation and acknowledgement identity. */
export function presentEmployerCheck(
  check: AuditCheck,
  summary: EmployerHoursSummary | null,
  report: TimeReport | null
): Required<Pick<CheckPresentation, 'title' | 'facts' | 'info'>> & Pick<CheckPresentation, 'formula'> {
  const view = {
    title: check.title,
    formula: undefined as string | undefined,
    facts: [] as string[],
    info: cleanInfo(check.detail),
    ...check.presentation
  };
  const titles: Record<string, string> = {
    'Istzeit: Tageswerte / Monatssumme': 'Istzeit: Monatssumme',
    'Geplante Sollzeit: Tageswerte / Monatssumme': 'Geplante Sollzeit: Monatssumme',
    'BD-Dauer: Tageswerte / Monatssumme': 'BD-Dauer: Monatssumme',
    'BD-Anzahl: Tageswerte / Monatssumme': 'BD-Anzahl: Monatssumme',
    'Nachtstunden: Tageswerte / Lohnart': 'Nachtstunden: Monatssumme',
    'Nachtstunden: regulär + BD': 'Nachtstunden: Regeldienst + BD',
    'Samstagsstunden: Tageswerte / Lohnart': 'Samstagsstunden: Monatssumme',
    'Sonntagsstunden: Tageswerte / Lohnart': 'Sonntagsstunden: Monatssumme',
    'BD-Auszahlung: Tageswerte / Kontoaufbau': 'BD-Kontoaufbau'
  };
  view.title = titles[check.title] ?? view.title;
  if (check.title === 'Nachtstunden: Tageswerte / Lohnart' && report && known(report.wageTypes.night)) {
    view.info += ` Regeldienst: ${amount(report.wageTypes.night)}; BD: ${amount(report.wageTypes.nightStandby ?? 0)}; zusammen: ${amount(Math.round((report.wageTypes.night + (report.wageTypes.nightStandby ?? 0)) * 100) / 100)}.`;
  }
  if (!summary) return view;
  const assumptions = (prefixes: string[]) =>
    summary.assumptions.filter(note => prefixes.some(prefix => note.startsWith(prefix)));
  const {
    openingBalance,
    actualHours,
    contractualTarget,
    adjustmentHours,
    standbyCredit,
    monthlyDelta,
    overtimeBasis,
    plannedTarget,
    computedClosingBalance
  } = summary;
  if (check.title.startsWith('Zeitkonto:')) {
    const hasCredit = standbyCredit.days.length > 0 || standbyCredit.unresolvedDates.length > 0;
    view.title = `Zeitkonto: ${hours(openingBalance)} + ${hours(actualHours)}${hasCredit ? ` + ${hours(standbyCredit.hours)}` : ''} − ${hours(contractualTarget)} + ${hours(adjustmentHours)} = ${amount(computedClosingBalance)}`;
    view.formula = `Anfang + Ist${hasCredit ? ' + BD-FZA' : ''} − Vertragssoll + Korrektur`;
    view.facts = [
      `Anfangsstand: ${amount(openingBalance)}`,
      `Istzeit: ${amount(actualHours)}`,
      ...(hasCredit
        ? [
            `BD-FZA-Zugang: ${amount(standbyCredit.hours)}`,
            ...standbyCredit.days.map(day => `${day.date}: ${amount(day.hours)}`)
          ]
        : []),
      `Vertragssoll: ${amount(contractualTarget)}`,
      `Korrektur: ${amount(adjustmentHours)}`,
      ...assumptions(['Anfangsguthaben', 'Istzeit', 'Vertragliches Soll', 'Korrektur', 'BD-FZA'])
    ];
    if (known(check.reported) && Math.abs(check.reported - computedClosingBalance) > 0.011)
      view.facts.push(
        `Differenz zum Nachweis: ${amount(Math.round((check.reported - computedClosingBalance) * 100) / 100)}`
      );
    view.info = 'Bezahlte BD und das separate faktorisierte BD-Konto werden hier nicht zusätzlich angerechnet.';
  } else if (check.title.startsWith('Monatssaldo:')) {
    view.title = `Monatssaldo: ${hours(actualHours)} − ${hours(contractualTarget)} = ${amount(monthlyDelta)}`;
    view.formula = 'Ist − Vertragssoll';
    view.facts = assumptions(['Istzeit', 'Vertragliches Soll']);
    view.info = 'Rechnerischer Monatssaldo; daraus folgt kein tariflicher Überstundenanspruch.';
  } else if (check.title.startsWith('Überstundenbasis:')) {
    const target = Math.max(plannedTarget, contractualTarget);
    view.title = `Überstunden: ${amount(overtimeBasis)}`;
    view.facts = [
      `Istzeit: ${amount(actualHours)}`,
      `Geplantes Soll: ${amount(plannedTarget)}`,
      `Vertragssoll: ${amount(contractualTarget)}`,
      `Verwendete Sollzeit: ${amount(target)}`,
      `Differenz: ${amount(Math.round((actualHours - target) * 100) / 100)}`,
      ...assumptions(['Istzeit', 'Geplante Sollzeit', 'Vertragliches Soll'])
    ];
    view.info =
      'Die Istzeit wird mit der höheren Sollzeit verglichen: max(geplantes Soll; Vertragssoll). Nur eine positive Differenz ergibt Überstunden-Zuschlagsstunden.';
  }
  return view;
}
