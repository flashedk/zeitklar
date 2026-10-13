import { rulesAt, type Rules } from './model';
export const federalStates = [
  { code: 'BW', name: 'Baden-Württemberg' },
  { code: 'BY', name: 'Bayern' },
  { code: 'BE', name: 'Berlin' },
  { code: 'BB', name: 'Brandenburg' },
  { code: 'HB', name: 'Bremen' },
  { code: 'HH', name: 'Hamburg' },
  { code: 'HE', name: 'Hessen' },
  { code: 'MV', name: 'Mecklenburg-Vorpommern' },
  { code: 'NI', name: 'Niedersachsen' },
  { code: 'NW', name: 'Nordrhein-Westfalen' },
  { code: 'RP', name: 'Rheinland-Pfalz' },
  { code: 'SL', name: 'Saarland' },
  { code: 'SN', name: 'Sachsen' },
  { code: 'ST', name: 'Sachsen-Anhalt' },
  { code: 'SH', name: 'Schleswig-Holstein' },
  { code: 'TH', name: 'Thüringen' }
];
type Holiday = { date: string; name: string };
/** Gregorian Easter (Meeus/Jones/Butcher), UTC civil dates without DST shifts. */
function easter(year: number) {
  const a = year % 19,
    b = Math.floor(year / 100),
    c = year % 100,
    d = Math.floor(b / 4),
    e = b % 4;
  const f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451),
    n = h + l - 7 * m + 114;
  return new Date(Date.UTC(year, Math.floor(n / 31) - 1, (n % 31) + 1));
}
/** Statewide holidays plus explicitly selected municipality-specific exceptions. */
export function getHolidays(
  year: number,
  state: string,
  options: { assumption?: boolean; augsburg?: boolean; corpusChristi?: boolean } = {}
): Holiday[] {
  if (!Number.isInteger(year) || year < 2000 || year > 2099 || !federalStates.some(s => s.code === state)) return [];
  const list: Holiday[] = [],
    seen = new Set<string>();
  const fixed = (suffix: string, name: string) => {
    const date = `${year}-${suffix}`;
    if (!seen.has(date)) {
      list.push({ date, name });
      seen.add(date);
    }
  };
  const relative = (offset: number, name: string) => {
    const date = new Date(easter(year).getTime() + offset * 86400000).toISOString().slice(0, 10);
    fixed(date.slice(5), name);
  };
  fixed('01-01', 'Neujahr');
  relative(-2, 'Karfreitag');
  relative(1, 'Ostermontag');
  fixed('05-01', 'Tag der Arbeit');
  relative(39, 'Christi Himmelfahrt');
  relative(50, 'Pfingstmontag');
  fixed('10-03', 'Tag der Deutschen Einheit');
  fixed('12-25', '1. Weihnachtstag');
  fixed('12-26', '2. Weihnachtstag');
  if (['BW', 'BY', 'ST'].includes(state)) fixed('01-06', 'Heilige Drei Könige');
  if ((state === 'BE' && year >= 2019) || (state === 'MV' && year >= 2023)) fixed('03-08', 'Internationaler Frauentag');
  if (state === 'BB') {
    relative(0, 'Ostersonntag');
    relative(49, 'Pfingstsonntag');
  }
  if (['BW', 'BY', 'HE', 'NW', 'RP', 'SL'].includes(state) || (['SN', 'TH'].includes(state) && options.corpusChristi))
    relative(60, 'Fronleichnam');
  if (state === 'BY' && options.augsburg) fixed('08-08', 'Augsburger Friedensfest');
  if (state === 'SL' || (state === 'BY' && options.assumption)) fixed('08-15', 'Mariä Himmelfahrt');
  if (state === 'TH' && year >= 2019) fixed('09-20', 'Weltkindertag');
  if (
    year === 2017 ||
    ['BB', 'MV', 'SN', 'ST', 'TH'].includes(state) ||
    (year >= 2018 && ['HB', 'HH', 'NI', 'SH'].includes(state))
  )
    fixed('10-31', 'Reformationstag');
  if (['BW', 'BY', 'NW', 'RP', 'SL'].includes(state)) fixed('11-01', 'Allerheiligen');
  if (state === 'SN') {
    const date = new Date(Date.UTC(year, 10, 22));
    while (date.getUTCDay() !== 3) date.setUTCDate(date.getUTCDate() - 1);
    fixed(date.toISOString().slice(5, 10), 'Buß- und Bettag');
  }
  if (state === 'BE' && [2020, 2025].includes(year)) fixed('05-08', 'Tag der Befreiung (einmaliger Feiertag)');
  return list.sort((a, b) => a.date.localeCompare(b.date));
}
export function effectiveHolidays(rules: Rules, year: number): string[] {
  if (rules.previous?.length) {
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const byProfile = new Map<Rules, string[]>();
    for (const month of months) {
      const effective = rulesAt(rules, month);
      byProfile.set(effective, [...(byProfile.get(effective) ?? []), month]);
    }
    return [...byProfile]
      .flatMap(([effective, inMonths]) =>
        profileHolidays(effective, year).filter(date => inMonths.includes(date.slice(0, 7)))
      )
      .sort();
  }
  return profileHolidays(rules, year);
}
function profileHolidays(rules: Rules, year: number): string[] {
  return [
    ...new Set([
      ...rules.holidays,
      ...getHolidays(year, rules.federalState, {
        assumption: rules.localAssumption,
        augsburg: rules.localAugsburg,
        corpusChristi: rules.localCorpusChristi
      }).map(h => h.date)
    ])
  ].sort();
}
