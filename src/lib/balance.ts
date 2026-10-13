import { getEmployerHours } from './audit';
import { calculate } from './calculate';
import {
  durationMinutes,
  emptySettlement,
  isDuty,
  migrateSettlement,
  minute,
  validMonth,
  type Entry,
  type Rules,
  type Settlement
} from './model';
import type { TimeReport } from './report';

/** Promote an explicitly saved legacy opening, including zero, without clearing old data. */
export function migrateOpeningRules(rules: Rules, settlements: Settlement[]): Rules {
  if (rules.openingHoursEntered || rules.openingMonth) return rules;
  const first = settlements
    .map(migrateSettlement)
    .filter(value => value.openingHoursEntered && validMonth(value.month) && Number.isFinite(value.openingHours))
    .sort((a, b) => a.month.localeCompare(b.month))[0];
  return first
    ? { ...rules, openingMonth: first.month, openingHours: first.openingHours, openingHoursEntered: true }
    : rules;
}

/** Carry forward consecutive report or personal-entry months, applying the initial anchor once. */
export function resolveMonthSettlement(
  rules: Rules,
  month: string,
  settlements: Settlement[],
  reports: TimeReport[],
  entries: Entry[] = []
): Settlement {
  const saved = new Map(settlements.map(value => [value.month, value]));
  const sources = new Map(reports.map(value => [value.period, value]));
  const cache = new Map<string, Settlement>();
  const personalMonths = new Map<string, Entry[]>();
  for (const entry of entries) {
    const months = new Set([entry.date.slice(0, 7)]);
    if (isDuty(entry) && entry.kind !== 'oncall') {
      const lastMinute = Date.parse(entry.date) + (minute(entry.start) + durationMinutes(entry)) * 60000 - 1;
      months.add(new Date(lastMinute).toISOString().slice(0, 7));
    }
    for (const ownMonth of months) {
      const bucket = personalMonths.get(ownMonth) ?? [];
      bucket.push(entry);
      personalMonths.set(ownMonth, bucket);
    }
  }
  const configured = rules.openingHoursEntered === true && !!rules.openingMonth;
  function resolve(current: string): Settlement {
    const cached = cache.get(current);
    if (cached) return cached;
    const raw = {
      ...(saved.get(current) ?? emptySettlement(current)),
      recordedHours: null,
      recordedBalance: null,
      paidBonus: null,
      targetHours: null,
      overtimeHours: 0,
      overtimePaidHours: 0,
      extraPay: 0
    };
    delete raw.openingHoursOrigin;
    delete raw.openingHoursGap;
    const [year, index] = current.split('-').map(Number);
    const priorMonth = new Date(Date.UTC(year, index - 2, 1)).toISOString().slice(0, 7);
    const prior = sources.get(priorMonth);
    if (configured && current === rules.openingMonth) {
      raw.openingHours = rules.openingHours;
      raw.openingHoursEntered = true;
      raw.openingHoursOrigin = 'initial';
    } else if (!configured && raw.openingHoursEntered) {
      // Profiles without a global anchor retain explicit legacy monthly openings.
    } else if (prior) {
      if (Number.isFinite(prior.totals.closingBalance)) raw.openingHours = prior.totals.closingBalance!;
      else {
        const priorSettlement = resolve(priorMonth);
        raw.openingHours = getEmployerHours(prior, rules, priorSettlement).computedClosingBalance;
        if (!Number.isFinite(prior.totals.openingBalance) && priorSettlement.openingHoursGap)
          raw.openingHoursGap = priorSettlement.openingHoursGap;
      }
      raw.openingHoursEntered = true;
      raw.openingHoursOrigin = 'previous';
    } else if (personalMonths.has(priorMonth)) {
      const priorSettlement = resolve(priorMonth);
      raw.openingHours =
        Math.round(
          (calculate(personalMonths.get(priorMonth)!, rules, priorMonth, priorSettlement).balance + Number.EPSILON) *
            100
        ) / 100;
      raw.openingHoursEntered = true;
      raw.openingHoursOrigin = 'personal';
      if (priorSettlement.openingHoursGap) raw.openingHoursGap = priorSettlement.openingHoursGap;
    } else {
      raw.openingHours = 0;
      raw.openingHoursEntered = false;
      raw.openingHoursGap = `Zeitnachweis und eigene Zeitaufzeichnungen für ${priorMonth} fehlen; Anfangsstand für ${current} vorläufig mit 0 h angenommen.`;
    }
    cache.set(current, raw);
    return raw;
  }
  if (!validMonth(month)) throw new Error('Ungültiger Monat.');
  return resolve(month);
}
