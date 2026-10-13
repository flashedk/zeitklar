import { calculate, percentageRate } from './calculate';
import { effectiveRules, rulesAt, dailyTargetHours, emptySettlement, type Entry, type Rules } from './model';
import { effectiveHolidays } from './holidays';
import { tariffProfile } from './tariff';
import { standbyCompensation } from './standby-credit';
import {
  calculateContinuedPay,
  emptyContinuedPay,
  referenceSourceKey,
  SICK_PAY_REFERENCE_DIVISOR,
  type ContinuedPay
} from './continued-pay';
import {
  hasPlannedFree,
  isSickReportDay,
  isVacationReportDay,
  sickEntryEligible,
  vacationEntryEligible,
  sickReportDayEligible
} from './absence';
import type { AuditCheck, ReportAudit, TimeReport } from './report';

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
type SickDate = { date: string; eligible: boolean; source: string };
type AbsenceKind = 'sick' | 'vacation';
export type SickPayLine = {
  kind: AbsenceKind;
  start: string;
  dates: string[];
  excluded: string[];
  count: number;
  months: string[];
  sum: number;
  divisor: number;
  dailyRate: number | null;
  amount: number | null;
  detail: string;
  basisKey: string;
  referenceDetails?: string[];
  rateBasisKey?: string;
  legacyAcknowledgedAt?: string;
};
export type SicknessAudit = { lines: SickPayLine[]; checks: AuditCheck[]; amount: number | null; count: number };

/** The overview and remuneration card use the same total, including months with only sick pay. */
export function compensationTotal(audit: ReportAudit | null, sickness: SicknessAudit | null): number | null {
  if (sickness?.amount === null || (audit && !audit.payAvailable)) return null;
  if (!audit && !sickness) return null;
  return round((audit?.estimatedPay ?? 0) + (sickness?.amount ?? 0));
}

function absenceDates(entries: Entry[], reports: TimeReport[], rules: Rules, kind: AbsenceKind): SickDate[] {
  const days = new Map<string, SickDate>();
  const eligible = kind === 'sick' ? sickEntryEligible : vacationEntryEligible,
    isDay = kind === 'sick' ? isSickReportDay : isVacationReportDay;
  const field = kind === 'sick' ? 'sickPayEligible' : 'vacationPayEligible';
  for (const e of entries.filter(e => e.kind === kind))
    days.set(e.date, { date: e.date, eligible: eligible(e, rules), source: 'eigener Eintrag' });
  for (const report of reports)
    for (const day of report.days) {
      // Illness during planned leave is counted only as illness, never paid twice.
      if (kind === 'vacation' && isSickReportDay(day)) {
        days.delete(day.date);
        continue;
      }
      if (!isDay(day)) continue;
      const override = entries.find(e => e.kind === kind && e.date === day.date && e.meta?.[field] !== undefined);
      days.set(day.date, {
        date: day.date,
        eligible: override ? eligible(override, rules) : sickReportDayEligible(day),
        source: override
          ? 'eigene Planangabe'
          : `Nachweis (Soll ${day.plannedHours ?? 0} h / Ist ${day.actualHours ?? 0} h)`
      });
    }
  if (kind === 'vacation') for (const e of entries.filter(e => e.kind === 'sick')) days.delete(e.date);
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function sicknessMonths(entries: Entry[], reports: TimeReport[], rules: Rules): string[] {
  return [...new Set(absenceDates(entries, reports, rules, 'sick').map(d => d.date.slice(0, 7)))];
}
export function continuedAbsenceMonths(entries: Entry[], reports: TimeReport[], rules: Rules): string[] {
  return [
    ...new Set(
      ['sick', 'vacation'].flatMap(kind =>
        absenceDates(entries, reports, rules, kind as AbsenceKind).map(d => d.date.slice(0, 7))
      )
    )
  ];
}
function payDetail(line: SickPayLine): string {
  const daysLabel = line.kind === 'sick' ? 'Krankheitstage' : 'Urlaubstage',
    dayLabel = line.kind === 'sick' ? 'Krankheitstag' : 'Urlaubstag';
  return `${daysLabel}: ${line.count}${line.dates.length ? ` (${line.dates.join(', ')})` : ''}. ${line.excluded.length ? `Nicht gezählt: ${line.excluded.join(', ')} – geplantes Frei/FZA oder keine Soll-/Istgutschrift. ` : ''}${line.referenceDetails?.join('. ')}. ${line.kind === 'vacation' ? 'Urlaubsabrechnung: drei volle Vormonate des ausgewählten Dienstmonats; ' : 'Krankheitsabrechnung: drei volle Vormonate vor Krankheitsbeginn; '}Referenzbeträge ohne zusätzliche Tabellenanpassung. Abrechnungsmethode: fester Tages-Teiler ${line.divisor} (1/${line.divisor}), ohne Abzug früherer Urlaubs- oder Krankheitstage. ${line.dailyRate === null ? 'Tagessatz offen: drei Referenzmonate benötigt.' : `${money(line.sum)} ÷ ${line.divisor} = ${money(line.dailyRate)} pro ${dayLabel}. ${line.count} × ${money(line.dailyRate)} = ${money(line.amount ?? 0)}.`} Feste Monatszulagen und nicht dienstplanmäßige Überstunden sind ausgeschlossen. Auszahlung anhand der Lohnabrechnung prüfen.`;
}
function vacationContinues(from: string, to: string, entries: Entry[], reports: TimeReport[], rules: Rules): boolean {
  if (entries.some(e => e.date > from && e.date < to && e.kind !== 'vacation')) return false;
  const holidays = new Set([
    ...effectiveHolidays(rules, Number(from.slice(0, 4))),
    ...effectiveHolidays(rules, Number(to.slice(0, 4)))
  ]);
  for (let time = Date.parse(from) + 86400000; time < Date.parse(to); time += 86400000) {
    const date = new Date(time).toISOString().slice(0, 10);
    const day = reports.flatMap(r => r.days).find(d => d.date === date);
    if (day && hasPlannedFree([day.label, ...day.spans.map(s => s.label)].join(' '))) continue;
    // A scheduled or recorded service interrupts leave even on a holiday or weekend.
    if (day && ((day.actualHours ?? 0) > 0 || (day.plannedHours ?? 0) > 0)) return false;
    if (
      holidays.has(date) ||
      dailyTargetHours(rules, date) === 0 ||
      (rulesAt(rules, date).tariff && ['12-24', '12-31'].includes(date.slice(5)))
    )
      continue;
    // Missing workday records are not evidence of uninterrupted leave.
    return false;
  }
  return true;
}
function reference(month: string, entries: Entry[], reports: TimeReport[], timeline: Rules, state: ContinuedPay) {
  const rules = rulesAt(timeline, month);
  const saved = state.references.find(r => r.month === month && r.confirmed);
  const report = reports.find(r => r.period === month);
  if (saved && (!saved.sourceKey || (report && referenceSourceKey(report, rules) === saved.sourceKey))) {
    return {
      amount: round(Object.values(saved.amounts).reduce<number>((n, a) => n + (a ?? 0), 0) - saved.excludedAmount),
      detail: `${month}: ${money(Object.values(saved.amounts).reduce<number>((n, a) => n + (a ?? 0), 0) - saved.excludedAmount)} aus bestätigten Referenzbeträgen`,
      key: JSON.stringify(saved)
    };
  }
  let amount = 0;
  const notes: string[] = [];
  const profile = tariffProfile(rules, month);
  if (report) {
    const wage = (key: string) => report.wageTypes[key] ?? 0;
    const recognised = ['night', 'nightStandby', 'nightTotal', 'saturday', 'sunday', 'holiday35', 'holiday135'];
    if (profile.bonusRate === null || !recognised.some(k => Object.hasOwn(report.wageTypes, k)))
      return { amount: null, detail: `${month}: Zuschlagsgrundlage fehlt`, key: referenceSourceKey(report, rules) };
    const nightRate = percentageRate(profile.bonusRate, rules.tariff ? 20 : rules.nightPercent);
    const hasNightSplit =
      typeof report.wageTypes.night === 'number' || typeof report.wageTypes.nightStandby === 'number';
    amount =
      (hasNightSplit
        ? round(wage('night') * nightRate) + round(wage('nightStandby') * nightRate)
        : round(wage('nightTotal') * nightRate)) +
      round(wage('saturday') * percentageRate(profile.bonusRate, 20)) +
      round(wage('sunday') * percentageRate(profile.bonusRate, rules.tariff ? 25 : rules.sundayPercent)) +
      round(wage('holiday35') * percentageRate(profile.bonusRate, rules.tariff ? 35 : rules.holidayPercent)) +
      round(wage('holiday135') * percentageRate(profile.bonusRate, 135));
    for (const day of report.days) {
      if (standbyCompensation(day) !== 'paid' || hasPlannedFree(day.label)) continue;
      if (day.standbyWeightedHours !== null && profile.individualRate !== null)
        amount += day.standbyWeightedHours * profile.individualRate;
    }
    if ((report.totals.bdHours ?? 0) > 0 && !report.days.some(day => standbyCompensation(day) === 'paid'))
      notes.push('BD-Grundvergütung im Nachweis nicht eindeutig als bezahlt ausgewiesen');
    if (wage('holiday100') > 0) notes.push('FT100% ohne geklärte Vergütungsbasis ausgelassen');
    if (Object.values(report.wageTypes).some(v => v === null)) notes.push('leere Zuschlagsfelder als 0 angesetzt');
  } else {
    if (!entries.some(e => e.date.startsWith(month + '-')))
      return { amount: null, detail: `${month}: Nachweis oder eigene Einträge fehlen`, key: 'missing' };
    const own = calculate(entries, rules, month, emptySettlement(month));
    if (!own.payAvailable)
      return { amount: null, detail: `${month}: Stundenentgelt fehlt`, key: JSON.stringify(profile) };
    amount = own.rows.reduce((n, e) => n + e.bonus + (e.kind === 'callout' ? 0 : e.dutyPay), 0);
    notes.push('Schätzung aus eigenen Einträgen');
  }
  // Fixed monthly allowances and non-scheduled overtime are deliberately outside the average.
  // Use the payroll reference amounts unchanged for both sickness and vacation.
  const gross = round(amount);
  return {
    amount: gross,
    detail: `${month}: ${money(gross)} aus ${report ? 'Nachweis' : 'eigenen Zeiten'}${notes.length ? ` (${notes.join('; ')})` : ''}`,
    key: JSON.stringify([
      report ? referenceSourceKey(report, rules) : entries.filter(e => e.date.startsWith(month + '-')),
      rules,
      gross
    ])
  };
}
/**
 * Month-independent absence work (dates, absence blocks, reference amounts) for one fixed set of
 * inputs. Pass the same cache when evaluating many months of the same data; it is ignored for
 * any other inputs, so a stale cache can never change a result.
 */
export class AbsenceCache {
  readonly groups = new Map<AbsenceKind, SickDate[][]>();
  readonly references = new Map<string, ReturnType<typeof reference>>();
  constructor(
    readonly entries: Entry[],
    readonly reports: TimeReport[],
    readonly rules: Rules,
    readonly state: ContinuedPay
  ) {}
  matches(entries: Entry[], reports: TimeReport[], rules: Rules, state: ContinuedPay) {
    return this.entries === entries && this.reports === reports && this.rules === rules && this.state === state;
  }
}
export function automaticSickPay(
  entries: Entry[],
  reports: TimeReport[],
  rules: Rules,
  month: string,
  state: ContinuedPay = emptyContinuedPay(),
  cache?: AbsenceCache
): SicknessAudit | null {
  return automaticAbsencePay(entries, reports, rules, month, state, 'sick', cache);
}
export function automaticVacationPay(
  entries: Entry[],
  reports: TimeReport[],
  rules: Rules,
  month: string,
  state: ContinuedPay = emptyContinuedPay(),
  cache?: AbsenceCache
): SicknessAudit | null {
  return automaticAbsencePay(entries, reports, rules, month, state, 'vacation', cache);
}
export function automaticContinuedPay(
  entries: Entry[],
  reports: TimeReport[],
  rules: Rules,
  month: string,
  state: ContinuedPay = emptyContinuedPay(),
  cache?: AbsenceCache
): SicknessAudit | null {
  const parts = [
    automaticSickPay(entries, reports, rules, month, state, cache),
    automaticVacationPay(entries, reports, rules, month, state, cache)
  ].filter((p): p is SicknessAudit => p !== null);
  if (!parts.length) return null;
  return {
    lines: parts.flatMap(p => p.lines),
    checks: parts.flatMap(p => p.checks),
    count: parts.reduce((n, p) => n + p.count, 0),
    amount: parts.some(p => p.amount === null) ? null : round(parts.reduce((n, p) => n + (p.amount ?? 0), 0))
  };
}
/** Consecutive absence dates of one kind, grouped into blocks; independent of the evaluated month. */
function absenceGroups(entries: Entry[], reports: TimeReport[], rules: Rules, kind: AbsenceKind): SickDate[][] {
  const dates = absenceDates(entries, reports, rules, kind),
    isDay = kind === 'sick' ? isSickReportDay : isVacationReportDay;
  const groups: SickDate[][] = [];
  for (const d of dates) {
    const group = groups.at(-1),
      previous = group?.at(-1);
    const workedBetween =
      previous &&
      (entries.some(e => e.date > previous.date && e.date < d.date && e.kind !== kind) ||
        reports.some(r =>
          r.days.some(day => day.date > previous.date && day.date < d.date && (day.actualHours ?? 0) > 0 && !isDay(day))
        ));
    const continuing =
      previous &&
      (kind === 'vacation'
        ? vacationContinues(previous.date, d.date, entries, reports, rules)
        : Date.parse(d.date) - Date.parse(previous.date) <= 3 * 86400000 && !workedBetween);
    if (continuing) group!.push(d);
    else groups.push([d]);
  }
  return groups;
}
function automaticAbsencePay(
  entries: Entry[],
  reports: TimeReport[],
  rules: Rules,
  month: string,
  state: ContinuedPay,
  kind: AbsenceKind,
  cache?: AbsenceCache
): SicknessAudit | null {
  const usable = cache?.matches(entries, reports, rules, state) ? cache : undefined;
  const isDay = kind === 'sick' ? isSickReportDay : isVacationReportDay;
  const daysLabel = kind === 'sick' ? 'Krankheitstage' : 'Urlaubstage',
    reason = kind === 'sick' ? 'Krankheit' : 'Urlaub';
  let groups = usable?.groups.get(kind);
  if (!groups) {
    groups = absenceGroups(entries, reports, rules, kind);
    usable?.groups.set(kind, groups);
  }
  const referenceFor = (refMonth: string) => {
    const hit = usable?.references.get(refMonth);
    if (hit) return hit;
    const value = reference(refMonth, entries, reports, rules, state);
    usable?.references.set(refMonth, value);
    return value;
  };
  const lines: SickPayLine[] = groups
    .filter(g => g.some(d => d.date.startsWith(month + '-')))
    .map(group => {
      const current = group.filter(d => d.date.startsWith(month + '-')),
        paid = current.filter(d => d.eligible),
        excluded = current.filter(d => !d.eligible).map(d => d.date),
        start = group[0].date;
      const referenceMonth = kind === 'vacation' ? month : start.slice(0, 7);
      const [y, m] = referenceMonth.split('-').map(Number),
        months = [3, 2, 1].map(offset => new Date(Date.UTC(y, m - 1 - offset, 1)).toISOString().slice(0, 7));
      const refs = months.map(referenceFor);
      const sum = round(refs.reduce((n, r) => n + (r.amount ?? 0), 0)),
        divisor = SICK_PAY_REFERENCE_DIVISOR;
      const dailyRate = refs.some(r => r.amount === null) || divisor <= 0 ? null : round(sum / divisor),
        amount = paid.length === 0 ? 0 : dailyRate === null ? null : round(paid.length * dailyRate);
      const key = JSON.stringify([group, refs.map(r => r.key), effectiveRules(rules, month)]);
      const line: SickPayLine = {
        kind,
        start,
        dates: paid.map(d => d.date),
        excluded,
        count: paid.length,
        months,
        sum,
        divisor,
        dailyRate,
        amount,
        detail: '',
        referenceDetails: refs.map(r => r.detail),
        rateBasisKey: JSON.stringify([months, refs.map(r => r.key), effectiveRules(rules, month)]),
        basisKey: kind === 'sick' ? key : 'vacation:' + key
      };
      line.detail = payDetail(line);
      return line;
    });
  if (kind === 'vacation') {
    // Separate leave blocks with the same reference basis share one monthly payment position.
    const merged = new Map<string, SickPayLine>();
    for (const line of lines) {
      const previous = merged.get(line.rateBasisKey!);
      if (!previous) {
        merged.set(line.rateBasisKey!, line);
        continue;
      }
      previous.dates = [...new Set([...previous.dates, ...line.dates])].sort();
      previous.excluded = [...new Set([...previous.excluded, ...line.excluded])].sort();
      previous.count = previous.dates.length;
      previous.amount =
        previous.count === 0 ? 0 : previous.dailyRate === null ? null : round(previous.count * previous.dailyRate);
      previous.basisKey = JSON.stringify([previous.basisKey, line.basisKey]);
      previous.detail = payDetail(previous);
    }
    lines.splice(0, lines.length, ...merged.values());
  }
  // Preserve already saved manual periods and their receipts without keeping the old card in the UI.
  if (kind === 'sick' && !lines.length)
    for (const old of calculateContinuedPay(state, month, reports, rules)) {
      lines.push({
        kind,
        start: old.period.start,
        dates: old.days,
        excluded: [],
        count: old.days.length,
        months: old.months,
        sum: old.sum,
        divisor: old.divisor,
        dailyRate: old.dailyRate,
        amount: old.amount,
        detail: `Gespeicherter Krankheitszeitraum: ${old.days.length} Krankheitstage. ${money(old.sum)} ÷ ${old.divisor} Tage${old.dailyRate === null ? '' : ` = ${money(old.dailyRate)} pro Tag; ${old.days.length} × ${money(old.dailyRate)} = ${money(old.amount ?? 0)}`}. ${old.warnings.join(' ')} Auszahlung anhand der Lohnabrechnung prüfen.`,
        basisKey: old.key,
        legacyAcknowledgedAt: old.acknowledgedAt ?? undefined
      });
    }
  if (!lines.length) return null;
  const count = lines.reduce((n, l) => n + l.count, 0);
  const report = reports.find(r => r.period === month);
  const reported = report ? report.days.filter(d => isDay(d) && sickReportDayEligible(d)).length : null;
  const excluded = lines.flatMap(l => l.excluded);
  const dayCheck: AuditCheck = {
    title: daysLabel,
    status: reported !== null && reported !== count ? 'difference' : 'ok',
    expected: count,
    reported,
    unit: 'count',
    detail: `${count} anrechenbare ${daysLabel}: ${lines.flatMap(l => l.dates).join(', ') || 'keine'}. ${report ? `${kind === 'sick' ? 'Krankheits' : 'Urlaubs'}markierungen einschließlich Folgezeilen im Nachweis; gezählt werden Tage mit Soll-/Istgutschrift.` : 'Ermittlung aus eigenen Einträgen und geplanter Arbeitszeit.'}${excluded.length ? ` Nicht gezählt: ${excluded.join(', ')} – geplantes Frei/FZA oder keine Soll-/Istgutschrift.` : ''}`
  };
  const paymentChecks: AuditCheck[] = lines.map(l => ({
    title:
      lines.length === 1
        ? `Auszahlung: Entgeltfortzahlung ${reason}`
        : `Auszahlung: Entgeltfortzahlung ${reason} ab ${l.start}`,
    status: 'review',
    expected: l.amount,
    reported: null,
    unit: 'EUR',
    detail: l.detail,
    basisKey: l.basisKey,
    legacyAcknowledgedAt: l.legacyAcknowledgedAt
  }));
  return {
    lines,
    count,
    amount: lines.some(l => l.amount === null) ? null : round(lines.reduce((n, l) => n + (l.amount ?? 0), 0)),
    checks: [dayCheck, ...paymentChecks]
  };
}
