import type { AuditCheck, TimeReport } from './report';
import { standbyCompensation, standbyTimeCredit } from './standby-credit';

const present = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const round = (n: number) => Math.round(n * 100) / 100;
const show = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const isStandbyPayout = (label: string) =>
  /\bAusz\.?\s*BD\b|\bAuszahlung\s*(?:von\s*)?(?:BD|Bereitschaft)|\bBD\b.*\bAuszahlung/i.test(label);

function paidBasis(report: TimeReport): { hours: number | null; detail: string } {
  const paid = standbyTimeCredit(report, 'paid');
  const unknown = report.days.filter(day => (day.standbyHours ?? 0) > 0 && standbyCompensation(day) === 'unknown');
  const dailyHours = report.days.reduce((sum, day) => sum + (day.standbyHours ?? 0), 0);
  const incomplete = present(report.totals.bdHours) && Math.abs(report.totals.bdHours - dailyHours) > 0.011;
  const missing = unknown.length || paid.unresolvedDates.length || incomplete || !report.days.length;
  return {
    hours: missing ? null : paid.hours,
    detail: paid.days.length
      ? paid.days.map(day => `${day.date}: ${show(day.hours)} h`).join(' + ')
      : missing
        ? 'BD-Ausgleich oder Tagesbewertung nicht vollständig zugeordnet.'
        : 'Keine als bezahlt gekennzeichneten BD-Tageswerte.'
  };
}

/** Reconcile the payout account separately from FZA credits to the regular time account. */
export function standbyAccountChecks(report: TimeReport): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const paid = paidBasis(report);
  const check = (title: string, expected: number | null, reported: number | null, detail: string, uncertain = false) =>
    checks.push({
      title,
      expected,
      reported,
      detail,
      unit: 'h',
      status:
        expected === null || reported === null || uncertain
          ? 'review'
          : Math.abs(expected - reported) <= 0.011
            ? 'ok'
            : 'difference'
    });
  const reportedBuild = report.totals.bdFactoredBuild;
  const reportedTotal = report.totals.bdFactoredTotal;
  if (present(reportedBuild) || present(reportedTotal)) {
    if (present(reportedBuild))
      check(
        'BD-Auszahlung: Tageswerte / Kontoaufbau',
        paid.hours,
        reportedBuild,
        `Nur als bezahlt gekennzeichnete, bereits faktorisierte BD-Stunden: ${paid.detail}. BD-FZA wird auf dem normalen Zeitkonto berücksichtigt und gehört nicht zu diesem Aufbau.`
      );
    const build = present(reportedBuild) ? reportedBuild : paid.hours;
    const decrease = present(report.totals.bdFactoredDecrease) ? report.totals.bdFactoredDecrease : 0;
    const decreaseKnown = Object.hasOwn(report.totals, 'bdFactoredDecrease');
    check(
      'Faktorisiertes BD-Konto',
      build === null ? null : round(build - decrease),
      present(reportedTotal) ? reportedTotal : null,
      `Auszahlungs-BD: ${build === null ? 'unbekannter Aufbau' : `${show(build)} h Aufbau`} − ${show(decrease)} h Abbau = ${build === null ? 'offener' : `${show(round(build - decrease))} h`} Monatsbestand. ${decreaseKnown ? 'Ein ausgewiesenes leeres Abbaufeld wird als 0 h behandelt.' : 'Abbaufeld fehlt; vorläufig 0 h angenommen.'} Vormonatsumbuchungen bleiben im Originalnachweis; eine stimmige Stundenrechnung bestätigt noch keine Zahlung.`,
      !decreaseKnown
    );
    checks[checks.length - 1].presentation = {
      formula: `${build === null ? 'Unbekannter Aufbau' : `${show(build)} h Aufbau`} − ${show(decrease)} h Abbau = ${build === null ? 'offener Monatsbestand' : `${show(round(build - decrease))} h Monatsbestand`}.`,
      info: decreaseKnown
        ? 'Ein ausgewiesenes leeres Abbaufeld wird als 0 h behandelt.'
        : 'Abbaufeld fehlt; vorläufig 0 h angenommen.'
    };
  }
  return checks;
}
