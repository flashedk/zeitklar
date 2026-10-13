import { rulesAt, validDate, weeklyHours, type Rules } from './model';

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
// TV-Ärzte TdL, Anlagen A/B (ÄTV Nr. 10), full-time 40 hours/week.
const tableA = {
  '1': [5792.9, 6121.26, 6355.79, 6762.34, 7247.0, 7436.05],
  '2': [7645.72, 8286.77, 8849.64, 9165.95, 9338.38, 9576.69],
  '3': [9576.69, 10139.57, 10944.77, 11265.33],
  '4': [11265.33, 12070.52, 12711.58]
};
const tableB = {
  '1': [5934.83, 6271.23, 6511.51, 6928.02, 7424.55, 7618.23],
  '2': [7833.04, 8489.8, 9066.46, 9390.52, 9567.17, 9811.32],
  '3': [9811.32, 10387.99, 11212.92, 11541.33],
  '4': [11541.33, 12366.25, 13023.01]
};
// ÄTV Nr. 9, Anlagen A1/A2/B1/B2, officially published by Marburger Bund:
// https://www.marburger-bund.de/sites/default/files/tarifvertraege/2024-11/TdL%20TV-%C3%84rzte%20i.d.F.%209.%C3%84nderungsTV.pdf
const table2023 = {
  '1': [5104.24, 5393.56, 5600.21, 5958.42, 6385.47, 6552.04],
  '2': [6736.78, 7301.63, 7797.59, 8076.29, 8228.22, 8438.2],
  '3': [8438.2, 8934.16, 9643.64],
  '4': [9926.1, 10635.56, 11200.4]
};
const table2024 = {
  '1': [5308.41, 5609.3, 5824.22, 6196.76, 6640.89, 6814.12],
  '2': [7006.25, 7593.7, 8109.49, 8399.34, 8557.35, 8775.73],
  '3': [8775.73, 9291.53, 10029.39],
  '4': [10323.14, 11060.98, 11648.42]
};
const table2025 = {
  '1': [5626.91, 5945.86, 6173.67, 6568.57, 7039.34, 7222.97],
  '2': [7426.63, 8049.32, 8596.06, 8903.3, 9070.79, 9302.27],
  '3': [9302.27, 9849.02, 10631.15],
  '4': [10942.53, 11724.64, 12347.33]
};
const table2026January = { ...table2025, '3': [...table2025['3'], 10942.53] };
const thresholds = { '1': [0, 1, 2, 3, 4, 5], '2': [0, 3, 6, 8, 10, 12], '3': [0, 3, 6, 9], '4': [0, 3, 6] };
export function stageCount(group: Rules['group']) {
  if (!Object.hasOwn(thresholds, group)) throw new Error('Ungültige Entgeltgruppe.');
  return thresholds[group].length;
}
function validStage(group: Rules['group'], stage: number) {
  if (!Number.isInteger(stage) || stage < 1 || stage > stageCount(group))
    throw new Error('Die Stufe ist für die Entgeltgruppe ungültig.');
}
function validMonth(month: string) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error('Ungültiger Leistungsmonat.');
}
function monthly(group: Rules['group'], month: string, stage: number): number | null {
  validMonth(month);
  validStage(group, stage);
  if (month < '2023-10') return null;
  const table =
    month >= '2027-09'
      ? tableB
      : month >= '2026-04'
        ? tableA
        : month >= '2026-01'
          ? table2026January
          : month >= '2025-02'
            ? table2025
            : month >= '2024-04'
              ? table2024
              : table2023;
  return table[group][stage - 1] ?? null;
}
export function tariffRate(
  group: Rules['group'],
  month: string,
  stage = 3,
  fullWeeklyHours = month < '2026-01' ? 42 : 40
): number | null {
  const pay = monthly(group, month, stage);
  if (!Number.isFinite(fullWeeklyHours) || fullWeeklyHours <= 0 || fullWeeklyHours > 168)
    throw new Error('Ungültige volle Wochenarbeitszeit.');
  return pay === null ? null : round(pay / (4.348 * fullWeeklyHours));
}
function nextDate(date: string, years: number) {
  const original = new Date(date + 'T00:00:00Z');
  const month = original.getUTCMonth(),
    year = original.getUTCFullYear() + years;
  const day = Math.min(original.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}
export type TariffProfile = {
  stage: number;
  monthlyPay: number | null;
  individualRate: number | null;
  overtimeBaseRate: number | null;
  bonusRate: number | null;
  nextAdvance: string | null;
  fullWeeklyHours: number;
  divisor: number;
  warnings: string[];
};
/** Reconstruct stage history from the next advancement, assuming continuous time in one group. */
export function tariffProfile(timeline: Rules, month: string, date = month + '-01'): TariffProfile {
  validMonth(month);
  const rules = rulesAt(timeline, month);
  if (!validDate(date) || !date.startsWith(month + '-'))
    throw new Error('Das Bewertungsdatum muss im Leistungsmonat liegen.');
  let stage = rules.stage ?? 1;
  validStage(rules.group, stage);
  const count = stageCount(rules.group),
    warnings: string[] = [];
  let nextAdvance = rules.nextAdvanceDate || null;
  if (
    nextAdvance &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(nextAdvance) ||
      Number.isNaN(Date.parse(nextAdvance)) ||
      new Date(nextAdvance).toISOString().slice(0, 10) !== nextAdvance)
  )
    throw new Error('Ungültiges nächstes Aufstiegsdatum.');
  if (rules.rateMode !== undefined && !['manual', 'table'].includes(rules.rateMode))
    throw new Error('Ungültige Auswahl der Stundenentgelte.');
  if (stage === count) nextAdvance = null;
  if (nextAdvance) {
    while (stage > 1) {
      const entryDate = nextDate(nextAdvance, -(thresholds[rules.group][stage] - thresholds[rules.group][stage - 1]));
      if (entryDate.slice(0, 7) <= month) break;
      stage--;
      nextAdvance = entryDate;
    }
    if (stage === 1) {
      const firstEntry = nextDate(nextAdvance, -(thresholds[rules.group][1] - thresholds[rules.group][0]));
      if (month < firstEntry.slice(0, 7))
        warnings.push(
          `Zeitraum vor dem rekonstruierten Eintritt in Stufe 1 (${firstEntry}): Beschäftigungsbeginn und damalige Eingruppierung sind unbekannt; Stufe 1 ist nur eine Rechengrenze.`
        );
    }
  }
  while (nextAdvance && nextAdvance.slice(0, 7) <= month && stage < count) {
    stage++;
    nextAdvance =
      stage === count
        ? null
        : nextDate(nextAdvance, thresholds[rules.group][stage] - thresholds[rules.group][stage - 1]);
  }
  if (rules.nextAdvanceDate && (rules.stage ?? 1) < count)
    warnings.push(
      'Stufenhistorie rekonstruiert unter der Annahme ununterbrochener Laufzeit in derselben Entgeltgruppe. Unterbrechungen und abweichend anerkannte Zeiten bitte prüfen.'
    );
  else
    warnings.push(
      'Ohne verwertbares nächstes Aufstiegsdatum gilt die ausgewählte Stufe fest; frühere Stufen werden nicht rekonstruiert.'
    );
  const automatic = rules.tariff && rules.rateMode === 'table';
  const monthlyPay = automatic ? monthly(rules.group, month, stage) : null;
  const fullWeeklyHours = weeklyHours(rules, date),
    divisor = 4.348 * fullWeeklyHours;
  const validWeeklyBasis =
    Number.isFinite(fullWeeklyHours) &&
    fullWeeklyHours > 0 &&
    fullWeeklyHours <= 168 &&
    (!rules.workTimeChangeEnabled || validDate(rules.workTimeChangeDate ?? '2026-01-01'));
  if (!validWeeklyBasis)
    warnings.push('Wochenarbeitszeit oder Änderungsdatum ungültig: automatische Stundenentgelte sind nicht verfügbar.');
  const bonusRate = rules.tariff
    ? validWeeklyBasis
      ? tariffRate(rules.group, month, 3, fullWeeklyHours)
      : null
    : rules.hourlyRate;
  const individualRate = automatic
    ? validWeeklyBasis
      ? tariffRate(rules.group, month, stage, fullWeeklyHours)
      : null
    : rules.individualRate;
  const overtimeBaseRate = automatic
    ? validWeeklyBasis
      ? tariffRate(rules.group, month, Math.min(stage, 4), fullWeeklyHours)
      : null
    : rules.overtimeBaseRate;
  if (rules.tariff && bonusRate === null)
    warnings.push(
      'Für den Leistungsmonat ist keine verifizierte Entgelttabelle hinterlegt; automatische Tarifbeträge sind nicht verfügbar.'
    );
  if (automatic && monthlyPay === null && bonusRate !== null)
    warnings.push(
      'Die ausgewählte Stufe war in der damaligen Entgelttabelle noch nicht vorhanden; individuelles Stundenentgelt und Überstunden-Grundvergütung sind nicht verfügbar.'
    );
  if (!automatic && rules.tariff)
    warnings.push(
      'Individuelles Stundenentgelt und Überstunden-Grundvergütung werden manuell übernommen. Ein angezeigter Stufenaufstieg verändert diese Beträge nicht.'
    );
  return {
    stage,
    monthlyPay,
    individualRate,
    overtimeBaseRate,
    bonusRate,
    nextAdvance,
    fullWeeklyHours,
    divisor,
    warnings
  };
}
