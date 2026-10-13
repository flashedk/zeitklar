import {
  rulesAt,
  dailyTargetHours,
  durationMinutes,
  isDuty,
  minute,
  type Entry,
  type Rules,
  type Settlement
} from './model';
import { effectiveHolidays } from './holidays';
import { tariffProfile } from './tariff';
import { sickEntryEligible, vacationEntryEligible } from './absence';
import { configuredEntry } from './duty-entry';
export { tariffRate } from './tariff';
const DAY = 86400000;
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const hours = (n: number) =>
  new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
export const euro = (n: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
/** Hourly amounts are rounded individually before multiplication (§ 24 Abs. 4). */
export const percentageRate = (rate: number, percent: number) => round((rate * percent) / 100);
export type TimeSupplementAmounts = { night: number; weekend: number; holiday: number };
/** Allocate cents to the largest remainders so the breakdown keeps the existing rounded entry total. */
function roundedSupplements(amounts: TimeSupplementAmounts, total: number): TimeSupplementAmounts {
  const keys = ['night', 'weekend', 'holiday'] as const;
  const parts = keys.map(key => ({ key, cents: Math.floor(amounts[key] * 100), remainder: (amounts[key] * 100) % 1 }));
  const remaining = Math.round(total * 100) - parts.reduce((sum, part) => sum + part.cents, 0);
  const order = [...parts].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < remaining; i++) order[i % order.length].cents++;
  return Object.fromEntries(parts.map(part => [part.key, part.cents / 100])) as TimeSupplementAmounts;
}
/** The repeated/missing 02:00–03:00 hour needs actual offset-aware clock data. */
export function hasClockChange(entry: Entry) {
  if (!isDuty(entry)) return false;
  const year = Number(entry.date.slice(0, 4));
  const start = Date.parse(entry.date) + minute(entry.start) * 60000;
  const end = start + durationMinutes(entry) * 60000;
  for (const y of [year, year + 1])
    for (const month of [2, 9]) {
      const last = new Date(Date.UTC(y, month + 1, 0));
      const transition = Date.UTC(y, month, last.getUTCDate() - last.getUTCDay(), 2);
      if (start < transition + 3600000 && end > transition) return true;
    }
  return false;
}
export function calculate(entries: Entry[], timeline: Rules, month: string, settlement: Settlement) {
  const rules = rulesAt(timeline, month);
  entries = entries.map(entry => configuredEntry(entry, rules));
  const [year, m] = month.split('-').map(Number);
  const from = Date.UTC(year, m - 1, 1),
    to = Date.UTC(year, m, 1);
  const holidays = new Set([year - 1, year, year + 1].flatMap(y => effectiveHolidays(rules, y)));
  const profile = tariffProfile(rules, month);
  const rate = profile.bonusRate ?? 0;
  const individualRate = profile.individualRate ?? 0;
  const overtimeBaseRate = profile.overtimeBaseRate ?? 0;
  const dayProfiles = new Map<string, ReturnType<typeof tariffProfile>>();
  const profileForDate = (date: string) => {
    if (!dayProfiles.has(date)) dayProfiles.set(date, tariffProfile(rules, month, date));
    return dayProfiles.get(date)!;
  };
  const nightStart = rules.tariff ? (month < '2024-04' ? '21:00' : '20:00') : rules.nightStart,
    nightEnd = rules.tariff ? '06:00' : rules.nightEnd;
  const overtimeRate = round((rate * (rules.tariff ? 15 : rules.overtimePercent)) / 100);
  const ns = minute(nightStart),
    ne = minute(nightEnd);
  const warnings: string[] = [...profile.warnings];
  if (settlement.openingHoursGap) warnings.push(settlement.openingHoursGap);
  if (!rules.confirmed)
    warnings.push('Profil noch nicht bestätigt: Entgeltgruppe, Stundenentgelte, Sollzeit und Feiertage prüfen.');
  if (!rules.federalState)
    warnings.push('Bundesland fehlt: Feiertage und damit Sollzeit sowie Feiertagszuschläge sind unvollständig.');
  warnings.push(
    'Ein Monatsplus ist ein Zeitkontosaldo. Tarifliche Überstunden werden nur aus ausdrücklich angegebenen Überstunden berechnet.'
  );
  if (
    rules.tariff &&
    rules.workTimeChangeEnabled &&
    rules.workTimeChangeDate?.startsWith(month + '-') &&
    rules.workTimeChangeDate.slice(8) !== '01' &&
    (settlement.overtimeHours > 0 || settlement.overtimePaidHours > 0)
  )
    warnings.push(
      'Arbeitszeitänderung innerhalb des Monats: Überstunden aus der Monatsangabe verwenden den Stundenwert vom Monatsbeginn. Das Leistungsdatum muss für die genaue Vergütung bestätigt werden.'
    );
  const intervals = entries
    .filter(e => isDuty(e) && e.kind !== 'oncall')
    .map(e => ({
      date: e.date,
      start: Date.parse(e.date) + minute(e.start) * 60000,
      duration: durationMinutes(e) * 60000
    }))
    .sort((a, b) => a.start - b.start);
  let occupiedUntil = -Infinity;
  for (const span of intervals) {
    if (span.start < occupiedUntil && span.start < to && span.start + span.duration > from)
      warnings.push(
        `${span.date}: Eigene Dienste überschneiden sich. Doppelzählung von Arbeitszeit und Zuschlägen vor Bewertung korrigieren.`
      );
    occupiedUntil = Math.max(occupiedUntil, span.start + span.duration);
  }
  let target = 0;
  for (let day = from; day < to; day += DAY) {
    const iso = new Date(day).toISOString().slice(0, 10);
    if (!holidays.has(iso) && !(rules.tariff && ['12-24', '12-31'].includes(iso.slice(5))))
      target += dailyTargetHours(rules, iso);
  }
  target = settlement.targetHours ?? target;
  const rows = entries
    .map(e => {
      let worked = 0,
        credited = 0,
        night = 0,
        sunday = 0,
        holiday = 0,
        saturday = 0,
        special = 0,
        bonus = 0,
        dutyPay = 0,
        bdWeighted = 0;
      const supplements: TimeSupplementAmounts = { night: 0, weekend: 0, holiday: 0 };
      if (!isDuty(e)) {
        if (
          ['sick', 'vacation'].includes(e.kind) &&
          e.date.startsWith(month) &&
          !holidays.has(e.date) &&
          !(rules.tariff && ['12-24', '12-31'].includes(e.date.slice(5))) &&
          (e.kind === 'sick' ? sickEntryEligible(e, rules) : vacationEntryEligible(e, rules))
        )
          credited = dailyTargetHours(rules, e.date);
      } else {
        const start = minute(e.start),
          duration = durationMinutes(e);
        if (hasClockChange(e))
          warnings.push(
            `${e.date}: Dienst berührt die Zeitumstellung in Europe/Berlin. Dauer und Zuschläge verwenden lokale Uhrzeiten; die fehlende oder doppelte Stunde anhand der tatsächlichen Zeitstempel prüfen.`
          );
        const pause = e.meta?.pauseStart ? (minute(e.meta.pauseStart) - start + 1440) % 1440 : null;
        const weight = pause === null ? (duration - e.breakMinutes) / duration : 1;
        for (let i = 0; i < duration; i++) {
          const absolute = Date.parse(e.date) + (start + i) * 60000;
          if (absolute < from || absolute >= to || (pause !== null && i >= pause && i < pause + e.breakMinutes))
            continue;
          if (e.kind === 'oncall') continue;
          const date = new Date(absolute),
            iso = date.toISOString().slice(0, 10),
            t = date.getUTCHours() * 60 + date.getUTCMinutes();
          const datedProfile = profileForDate(iso);
          const datedBonusRate = datedProfile.bonusRate ?? 0;
          const datedNightRate = percentageRate(datedBonusRate, rules.tariff ? 20 : rules.nightPercent);
          const isNight = ns < ne ? t >= ns && t < ne : t >= ns || t < ne;
          const isSunday = date.getUTCDay() === 0,
            isHoliday = holidays.has(iso);
          const isSaturday =
            date.getUTCDay() === 6 && t >= 780 && t < (rules.tariff && iso < '2024-04-01' ? 1260 : 1200);
          const isSpecial = ['12-24', '12-31'].includes(iso.slice(5)) && t >= 360;
          const unit = weight / 60;
          worked += unit;
          if (isNight) night += unit;
          if (e.kind === 'standby') {
            const points = (e.meta?.bdLevel === 'II' ? 95 : 60) + (isHoliday ? 25 : 0) + (e.meta?.bdExtraPoints ?? 0);
            bdWeighted += (unit * points) / 100;
            bonus += isNight ? unit * datedNightRate : 0;
            supplements.night += isNight ? unit * datedNightRate : 0;
            if (!e.meta?.bdTimeOff) dutyPay += ((unit * points) / 100) * (datedProfile.individualRate ?? 0);
          } else {
            if (isSunday) sunday += unit;
            if (isHoliday) holiday += unit;
            if (isSaturday) saturday += unit;
            if (isSpecial) special += unit;
            const rates = [
              isSunday ? (rules.tariff ? 25 : rules.sundayPercent) : 0,
              isHoliday
                ? rules.tariff
                  ? (e.meta?.holidayCompensated ?? rules.holidayCompensated) === false
                    ? 135
                    : 35
                  : rules.holidayPercent
                : 0,
              rules.tariff && isSaturday ? 20 : 0,
              rules.tariff && isSpecial ? 35 : 0
            ];
            const highest = rules.tariff || rules.stacking === 'highest';
            const dayPercent = highest ? Math.max(...rates) : rates.reduce((a, b) => a + b, 0);
            const dayRate = round((datedBonusRate * dayPercent) / 100);
            bonus += unit * (dayRate + (isNight ? datedNightRate : 0));
            supplements.night += isNight ? unit * datedNightRate : 0;
            if (dayPercent > 0) {
              // Holiday/special-day pay wins ties with weekend pay; suppressed supplements contribute nothing.
              if (highest)
                supplements[rates[1] === dayPercent || rates[3] === dayPercent ? 'holiday' : 'weekend'] +=
                  unit * dayRate;
              else {
                supplements.weekend += (unit * dayRate * (rates[0] + rates[2])) / dayPercent;
                supplements.holiday += (unit * dayRate * (rates[1] + rates[3])) / dayPercent;
              }
            }
            if (e.kind === 'work')
              dutyPay += (unit * (datedProfile.individualRate ?? 0) * (e.meta?.planPercent ?? 0)) / 100;
          }
        }
        if (e.kind === 'oncall' && e.date.startsWith(month)) {
          const day = new Date(e.date).getUTCDay();
          dutyPay =
            (profileForDate(e.date).individualRate ?? 0) *
            (duration >= 720
              ? day === 0 || day === 6 || holidays.has(e.date)
                ? 4
                : 2
              : Math.ceil(duration / 60) * 0.125) *
            (1 + (e.meta?.planPercent ?? 0) / 100);
        }
        if (e.kind === 'callout' && e.date.startsWith(month)) {
          const datedProfile = profileForDate(e.date);
          dutyPay +=
            Math.ceil((duration - e.breakMinutes) / 60) *
            ((datedProfile.overtimeBaseRate ?? 0) +
              percentageRate(datedProfile.bonusRate ?? 0, rules.tariff ? 15 : rules.overtimePercent));
        }
        if (worked && e.breakMinutes > 0 && pause === null)
          warnings.push(`${e.date}: Pausenlage fehlt. Zuschlagszeiten sind proportional geschätzt.`);
        if (worked && e.kind === 'standby' && !e.meta?.bdLevel)
          warnings.push(`${e.date}: BD-Stufe fehlt; vorläufig mit Stufe I gerechnet.`);
        if (holiday > 0 && e.meta?.holidayCompensated === undefined && rules.holidayCompensated === undefined)
          warnings.push(`${e.date}: Feiertags-Freizeitausgleich ungeklärt; vorläufig 35 % angesetzt.`);
        if (worked && ['standby', 'callout'].includes(e.kind))
          warnings.push(
            `${e.date}: Dienstbewertung, Freizeitausgleich und Zusatzpunkte anhand des Dienstplans prüfen.`
          );
        if (worked && e.kind === 'callout')
          warnings.push(
            `${e.date}: Ruf-Einsatz einschließlich Wegezeit separat erfassen. Grundvergütung und 15 % werden je Einsatz auf volle Stunden gerundet; weitere Zeitzuschläge beziehen sich auf die erfassten Zeiten.`
          );
      }
      return {
        ...e,
        worked,
        credited,
        night,
        sunday,
        holiday,
        saturday,
        special,
        bonus: round(bonus),
        timeSupplements: roundedSupplements(supplements, round(bonus)),
        dutyPay: round(dutyPay),
        bdWeighted
      };
    })
    .filter(e => e.date.startsWith(month) || e.worked > 0);
  if (rows.some(e => ['standby', 'oncall'].includes(e.kind)) && !individualRate)
    warnings.push('Individuelles Stundenentgelt fehlt: Bereitschaftsvergütung ist unvollständig.');
  if ((rows.some(e => e.kind === 'callout') || settlement.overtimePaidHours > 0) && !overtimeBaseRate)
    warnings.push('Stundenentgelt für Überstunden (maximal Stufe 4) fehlt.');
  if (rows.some(e => e.kind === 'callout') && settlement.overtimeHours > 0)
    warnings.push(
      'Ruf-Einsätze enthalten bereits 15 % Überstundenzuschlag; bei den zusätzlich angegebenen Überstunden nicht erneut mitzählen.'
    );
  if (rows.some(e => e.kind === 'work' && (e.meta?.planPercent ?? 0) > 0) && !individualRate)
    warnings.push('Individuelles Stundenentgelt für den Dienstplanzuschlag fehlt.');
  if (rows.some(e => e.kind === 'standby'))
    warnings.push(
      'Zusätzliche BD-Bewertung (z. B. ab dem 5. Dienst oder bei Dienstplanänderung) muss als bestätigte Zusatzpunkte eingegeben werden.'
    );
  const sum = (
    key: 'worked' | 'credited' | 'night' | 'sunday' | 'holiday' | 'saturday' | 'special' | 'bonus' | 'dutyPay'
  ) => rows.reduce((n, e) => n + e[key], 0);
  const actual = sum('worked'),
    credited = sum('credited');
  const regular = rows.filter(e => e.kind === 'work').reduce((n, e) => n + e.worked, 0);
  const standbyCredit = rows
    .filter(e => e.kind === 'standby' && e.meta?.bdTimeOff === true)
    .reduce((n, e) => n + e.bdWeighted, 0);
  const standbyPaidHours = rows
    .filter(e => e.kind === 'standby' && e.meta?.bdTimeOff !== true)
    .reduce((n, e) => n + e.bdWeighted, 0);
  const delta = regular + credited + standbyCredit - target;
  const overtimeBonus = round(settlement.overtimeHours * overtimeRate);
  const expectedBonus = round(sum('bonus') + overtimeBonus);
  const dutyPay = round(sum('dutyPay') + settlement.overtimePaidHours * overtimeBaseRate + settlement.extraPay);
  const expectedPay = round(expectedBonus + dutyPay);
  const balance = settlement.openingHours + delta + settlement.adjustmentHours;
  const missing: string[] = [];
  for (let day = from; day < to; day += DAY) {
    const d = new Date(day),
      iso = d.toISOString().slice(0, 10);
    if (
      dailyTargetHours(rules, iso) > 0 &&
      !holidays.has(iso) &&
      !(rules.tariff && ['12-24', '12-31'].includes(iso.slice(5))) &&
      !entries.some(e => e.date === iso)
    )
      missing.push(iso);
  }
  if (missing.length)
    warnings.push(
      `${missing.length} Tage mit Sollzeit ohne Eintrag. Fehlende Daten oder dienstplanmäßig freie Tage prüfen.`
    );
  const payAvailable =
    profile.bonusRate !== null &&
    (!rows.some(
      e =>
        e.kind === 'oncall' ||
        (e.kind === 'standby' && !e.meta?.bdTimeOff) ||
        (e.kind === 'work' && (e.meta?.planPercent ?? 0) > 0)
    ) ||
      profile.individualRate !== null) &&
    (!(settlement.overtimePaidHours > 0 || rows.some(e => e.kind === 'callout')) || profile.overtimeBaseRate !== null);
  return {
    rows,
    target,
    actual,
    regular,
    credited,
    standbyCredit,
    standbyPaidHours,
    delta,
    balance,
    expectedBonus,
    overtimeBonus,
    dutyPay,
    expectedPay,
    rate,
    payAvailable,
    profile,
    night: sum('night'),
    sunday: sum('sunday'),
    holiday: sum('holiday'),
    saturday: sum('saturday'),
    special: sum('special'),
    missing,
    warnings: [...new Set(warnings)],
    hoursDifference: settlement.recordedHours === null ? null : regular + credited - settlement.recordedHours,
    balanceDifference: settlement.recordedBalance === null ? null : balance - settlement.recordedBalance,
    bonusDifference: settlement.paidBonus === null || !payAvailable ? null : expectedPay - settlement.paidBonus
  };
}
