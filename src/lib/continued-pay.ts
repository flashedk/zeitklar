import { effectiveRules, validDate, validMonth, type Entry, type Rules } from './model';
import type { TimeReport } from './report';
import { auditReport } from './audit';
import { emptySettlement } from './model';
import { reportSignature } from './report-signature';

/** Fixed divisor used by the requested payroll calculation method. */
export const SICK_PAY_REFERENCE_DIVISOR = 65;

export const referenceLabels = {
  timeBonus: 'Zeitzuschläge',
  standby: 'Bereitschaftsdienst-Vergütung',
  oncall: 'Rufbereitschaft / Einsätze',
  plannedOvertime: 'Dienstplanmäßige Mehrarbeit / Überstunden',
  other: 'Weitere berücksichtigungsfähige variable Entgelte'
} as const;
export type ReferenceCategory = keyof typeof referenceLabels;
export type PayReference = {
  month: string;
  amounts: Record<ReferenceCategory, number | null>;
  excludedAmount: number;
  excludedDays: number;
  source: string;
  sourceKey: string;
  confirmed: boolean;
};
export type SickPeriod = {
  id: string;
  start: string;
  end: string;
  days: string[];
  workDaysPerWeek: number;
  employmentStart: string;
  workTimeChange: string;
  divisorOverride: number | null;
  individualAmount: number | null;
  individualDays: number | null;
  adjustments: Record<string, number>;
  confirmed: boolean;
  note: string;
};
export type ContinuedPay = {
  references: PayReference[];
  periods: SickPeriod[];
  acknowledgements: Record<string, string>;
};
export const emptyContinuedPay = (): ContinuedPay => ({ references: [], periods: [], acknowledgements: {} });
let periodSequence = 0;
/** Record identifiers must also work on ordinary HTTP origins, where randomUUID is unavailable. */
export function createSickPeriodId(): string {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return 'sick-' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  // These IDs identify editable records; they are neither credentials nor authorization tokens.
  return `sick-${Date.now().toString(36)}-${(++periodSequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
}
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const categories = Object.keys(referenceLabels) as ReferenceCategory[];
const number = (n: unknown, max = 1000000): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;
const text = (s: unknown, max = 2000): s is string => typeof s === 'string' && s.length <= max;
// A portable content checksum; this identifies a reviewed calculation, never authorizes access.
function fingerprint(value: string) {
  let a = 0x811c9dc5,
    b = 0x85ebca6b;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ value.charCodeAt(i), 0x27d4eb2f);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
export function referenceSourceKey(report: TimeReport, rules: Rules) {
  return fingerprint(reportSignature(report) + JSON.stringify(effectiveRules(rules, report.period)));
}
export function validateReference(raw: unknown): PayReference {
  const r = raw as PayReference;
  if (
    !r ||
    !validMonth(r.month) ||
    !r.amounts ||
    categories.some(k => r.amounts[k] !== null && !number(r.amounts[k])) ||
    !number(r.excludedAmount) ||
    !Number.isInteger(r.excludedDays) ||
    !number(r.excludedDays, 31) ||
    !text(r.source, 500) ||
    !text(r.sourceKey, 32) ||
    typeof r.confirmed !== 'boolean'
  )
    throw new Error('Ungültige Referenzbeträge für die Entgeltfortzahlung.');
  if (r.excludedAmount > categories.reduce((n, k) => n + (r.amounts[k] ?? 0), 0))
    throw new Error('Ausgeschlossene Fortzahlung darf die Referenzsumme nicht überschreiten.');
  if (r.confirmed && (categories.some(k => r.amounts[k] === null) || !r.source.trim()))
    throw new Error('Vor der Bestätigung alle Referenzpositionen ergänzen (auch 0 €) und die Quelle angeben.');
  return { ...r, amounts: Object.fromEntries(categories.map(k => [k, r.amounts[k]])) as PayReference['amounts'] };
}
export function validatePeriod(raw: unknown): SickPeriod {
  const p = raw as SickPeriod;
  if (
    !p ||
    !text(p.id, 80) ||
    !/^[\w-]+$/.test(p.id) ||
    !validDate(p.start) ||
    !validDate(p.end) ||
    p.end < p.start ||
    Date.parse(p.end) - Date.parse(p.start) > 366 * 86400000 ||
    !Array.isArray(p.days) ||
    p.days.length > 367 ||
    p.days.some(d => typeof d !== 'string' || !validDate(d) || d < p.start || d > p.end) ||
    !number(p.workDaysPerWeek, 7) ||
    p.workDaysPerWeek === 0 ||
    !text(p.employmentStart, 10) ||
    (p.employmentStart && (!validDate(p.employmentStart) || p.employmentStart > p.start)) ||
    !text(p.workTimeChange, 10) ||
    (p.workTimeChange && (!validDate(p.workTimeChange) || p.workTimeChange > p.start)) ||
    [p.divisorOverride, p.individualDays].some(n => n !== null && (!number(n, 366) || n === 0)) ||
    (p.individualAmount !== null && !number(p.individualAmount)) ||
    !p.adjustments ||
    typeof p.adjustments !== 'object' ||
    Array.isArray(p.adjustments) ||
    Object.keys(p.adjustments).length > 3 ||
    Object.entries(p.adjustments).some(([m, n]) => !validMonth(m) || !number(n, 100)) ||
    typeof p.confirmed !== 'boolean' ||
    !text(p.note)
  )
    throw new Error('Ungültiger Krankheitszeitraum oder ungültige Berechnungsgrundlage.');
  return { ...p, days: [...new Set(p.days)].sort() };
}
export function validateContinuedPay(raw: unknown): ContinuedPay {
  if (raw === undefined) return emptyContinuedPay();
  const v = raw as ContinuedPay;
  if (
    !v ||
    !Array.isArray(v.references) ||
    v.references.length > 1200 ||
    !Array.isArray(v.periods) ||
    v.periods.length > 1000 ||
    !v.acknowledgements ||
    typeof v.acknowledgements !== 'object' ||
    Array.isArray(v.acknowledgements) ||
    Object.keys(v.acknowledgements).length > 20000
  )
    throw new Error('Ungültige Entgeltfortzahlungsdaten.');
  const references = v.references.map(validateReference),
    periods = v.periods.map(validatePeriod);
  if (
    new Set(references.map(r => r.month)).size !== references.length ||
    new Set(periods.map(p => p.id)).size !== periods.length
  )
    throw new Error('Doppelte Referenzmonate oder Krankheitszeiträume.');
  const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].start <= sorted[i - 1].end)
      throw new Error(
        'Krankheitszeiträume überschneiden sich. Zusammenhängende Krankheit bitte als einen Zeitraum erfassen.'
      );
  for (const [key, date] of Object.entries(v.acknowledgements))
    if (!/^cp_[0-9a-f]{16}$/.test(key) || !text(date, 40) || !Number.isFinite(Date.parse(date)))
      throw new Error('Ungültige Auszahlungskontrolle für Entgeltfortzahlung.');
  return { references, periods, acknowledgements: { ...v.acknowledgements } };
}
export function referenceMonths(p: SickPeriod): string[] {
  const [year, month] = p.start.split('-').map(Number);
  const cutoff = [p.employmentStart, p.workTimeChange].filter(Boolean).sort().at(-1) ?? '';
  return [3, 2, 1]
    .map(offset => new Date(Date.UTC(year, month - 1 - offset, 1)).toISOString().slice(0, 7))
    .filter(m => m + '-01' >= cutoff);
}
export function suggestReference(month: string, reports: TimeReport[], rules: Rules): PayReference {
  const report = reports.find(r => r.period === month);
  const amounts: PayReference['amounts'] = {
    timeBonus: null,
    standby: null,
    oncall: null,
    plannedOvertime: null,
    other: null
  };
  if (report) {
    const audit = auditReport(report, rules, emptySettlement(month));
    const lines = audit.payLines.filter(
      l =>
        !l.label.includes('Überstunden') &&
        !l.label.includes('Schichtzulage') &&
        !l.label.includes('Wechselschichtzulage') &&
        l.label !== 'Bereitschaftsdienst zur Auszahlung'
    );
    if (lines.length && audit.estimatedPay !== null) amounts.timeBonus = round(lines.reduce((n, l) => n + l.amount, 0));
    const standby = audit.payLines.find(line => line.label === 'Bereitschaftsdienst zur Auszahlung');
    if (standby && audit.estimatedPay !== null) amounts.standby = standby.amount;
  }
  return {
    month,
    amounts,
    excludedAmount: 0,
    excludedDays: 0,
    source: report ? `Vorschlag aus ${report.filename}; übrige Positionen anhand Lohnabrechnung ergänzen` : '',
    sourceKey: report ? referenceSourceKey(report, rules) : '',
    confirmed: false
  };
}
export function suggestDays(start: string, end: string, entries: Entry[]): string[] {
  return [
    ...new Set(entries.filter(e => e.kind === 'sick' && e.date >= start && e.date <= end).map(e => e.date))
  ].sort();
}
export function continuedPayMonths(state: ContinuedPay): string[] {
  const months = new Set<string>();
  for (const p of state.periods) {
    const d = new Date(p.start + 'T00:00:00Z');
    d.setUTCDate(1);
    while (d.toISOString().slice(0, 7) <= p.end.slice(0, 7)) {
      months.add(d.toISOString().slice(0, 7));
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  }
  return [...months].sort();
}
export function calculateContinuedPay(state: ContinuedPay, month: string, reports: TimeReport[] = [], rules?: Rules) {
  return state.periods
    .filter(p => p.start.slice(0, 7) <= month && p.end.slice(0, 7) >= month)
    .map(p => {
      const months = referenceMonths(p),
        references = months.map(m => state.references.find(r => r.month === m));
      const warnings: string[] = [];
      if (!p.confirmed)
        warnings.push('Anspruch, ausgefallene Arbeitstage, Wochenverteilung und Berechnungsgrundlagen bestätigen.');
      if (p.days.some(d => Date.parse(d) - Date.parse(p.start) >= 42 * 86400000))
        warnings.push(
          'Ausfalltage nach der sechsten Woche: Anspruch und Beginn des Fortzahlungszeitraums prüfen; Krankengeldzuschuss wird hier nicht berechnet.'
        );
      let sum = 0,
        divisor = 0;
      if (!months.length) {
        if (p.individualAmount === null || p.individualDays === null)
          warnings.push(
            'Kein voller Referenzmonat: zustehende variable Entgelte und tatsächlich erbrachte Arbeitstage des individuellen Zeitraums ergänzen.'
          );
        sum = p.individualAmount ?? 0;
        divisor = p.individualDays ?? 0;
      } else {
        for (let i = 0; i < months.length; i++) {
          const r = references[i];
          if (!r?.confirmed || categories.some(k => r.amounts[k] === null)) {
            warnings.push(`${months[i]}: Referenzbeträge fehlen oder sind noch nicht bestätigt.`);
            continue;
          }
          if (r.sourceKey && rules) {
            const report = reports.find(report => report.period === r.month);
            if (!report || referenceSourceKey(report, rules) !== r.sourceKey)
              warnings.push(
                `${r.month}: Nachweis oder Profil hat sich geändert. Vorschlag neu übernehmen oder als manuelle Lohnabrechnungswerte bestätigen.`
              );
          }
          sum += round(
            (categories.reduce((n, k) => n + (r.amounts[k] ?? 0), 0) - r.excludedAmount) *
              (1 + (0.9 * (p.adjustments[r.month] ?? 0)) / 100)
          );
        }
        if (months.length < 3 && p.divisorOverride === null)
          warnings.push('Verkürzter Referenzzeitraum: passenden Tages-Teiler anhand der Abrechnung bestätigen.');
        divisor = months.length === 3 ? SICK_PAY_REFERENCE_DIVISOR : (p.divisorOverride ?? SICK_PAY_REFERENCE_DIVISOR);
      }
      if (divisor <= 0) warnings.push('Der Tages-Teiler muss größer als 0 sein.');
      const days = p.days.filter(d => d.startsWith(month + '-'));
      const dailyRate = warnings.length ? null : round(round(sum) / divisor);
      const amount = dailyRate === null ? null : round(dailyRate * days.length);
      const basis = months.length
        ? months.map((m, i) => `${m}: ${references[i] ? JSON.stringify(references[i]) : 'fehlt'}`).join('; ')
        : `Individuelle Basis ab ${p.workTimeChange || p.employmentStart || p.start}`;
      const key = 'cp_' + fingerprint(JSON.stringify([p, month, basis, sum, divisor, dailyRate, amount, warnings]));
      const acknowledgedAt = state.acknowledgements[key] ?? null;
      return { period: p, months, days, sum: round(sum), divisor, dailyRate, amount, warnings, key, acknowledgedAt };
    });
}
export function applyContinuedPayAction(
  state: ContinuedPay,
  form: FormData,
  reports: TimeReport[],
  rules: Rules
): ContinuedPay {
  const next = structuredClone(state),
    operation = String(form.get('operation'));
  if (operation === 'reference') {
    const ref = validateReference(JSON.parse(String(form.get('value'))));
    if (ref.sourceKey) {
      const report = reports.find(r => r.period === ref.month);
      if (!report || referenceSourceKey(report, rules) !== ref.sourceKey)
        throw new Error('Nachweisvorschlag ist veraltet. Neu übernehmen oder Quelle manuell bestätigen.');
    }
    next.references = [...next.references.filter(r => r.month !== ref.month), ref];
  } else if (operation === 'period') {
    const p = validatePeriod(JSON.parse(String(form.get('value'))));
    next.periods = [...next.periods.filter(v => v.id !== p.id), p];
  } else if (operation === 'delete') {
    const id = String(form.get('id'));
    if (!next.periods.some(p => p.id === id)) throw new Error('Krankheitszeitraum nicht gefunden.');
    next.periods = next.periods.filter(p => p.id !== id);
  } else if (operation === 'acknowledge') {
    const month = String(form.get('month')),
      key = String(form.get('key')),
      acknowledged = String(form.get('acknowledged'));
    if (!validMonth(month) || !['true', 'false'].includes(acknowledged))
      throw new Error('Ungültige Auszahlungskontrolle.');
    const line = calculateContinuedPay(next, month, reports, rules).find(line => line.key === key);
    if (!line || line.amount === null)
      throw new Error('Die Berechnung ist unvollständig oder veraltet. Bitte neu laden.');
    if (acknowledged === 'true') next.acknowledgements[key] = new Date().toISOString();
    else delete next.acknowledgements[key];
  } else throw new Error('Unbekannte Entgeltfortzahlungsaktion.');
  return validateContinuedPay(next);
}
/** Merge backups atomically; conflicts need an explicit edit, never silently overwrite confirmed bases. */
export function mergeContinuedPay(current: ContinuedPay, incoming: ContinuedPay): ContinuedPay {
  const next = structuredClone(current);
  for (const r of incoming.references) {
    const old = next.references.find(v => v.month === r.month);
    if (old && JSON.stringify(old) !== JSON.stringify(r))
      throw new Error(`Entgeltfortzahlung: abweichende Referenzbeträge für ${r.month}.`);
    if (!old) next.references.push(r);
  }
  for (const p of incoming.periods) {
    const old = next.periods.find(v => v.id === p.id);
    if (old && JSON.stringify(old) !== JSON.stringify(p))
      throw new Error('Entgeltfortzahlung: abweichender Krankheitszeitraum.');
    if (!old) next.periods.push(p);
  }
  next.acknowledgements = { ...incoming.acknowledgements, ...next.acknowledgements };
  return validateContinuedPay(next);
}
