import { validateDutyTemplates, type DutyTemplate } from './duty-templates';
export type Entry = {
  id?: number;
  date: string;
  start: string;
  end: string;
  breakMinutes: number;
  kind: 'work' | 'vacation' | 'sick' | 'standby' | 'oncall' | 'callout' | 'rest' | 'timeoff';
  note: string;
  source?: string;
  meta?: EntryMeta;
};
export type EntryMeta = {
  dutyName?: string;
  dutyDate?: string;
  fullDay?: boolean;
  pauseStart?: string;
  holidayCompensated?: boolean;
  bdLevel?: 'I' | 'II';
  bdExtraPoints?: number;
  bdTimeOff?: boolean;
  planPercent?: number;
  sickPayEligible?: boolean;
  vacationPayEligible?: boolean;
};
export const kinds: Record<Entry['kind'], string> = {
  work: 'Regeldienst',
  standby: 'Bereitschaftsdienst',
  oncall: 'Rufbereitschaft',
  callout: 'Ruf-Einsatz',
  vacation: 'Urlaub',
  sick: 'Krank',
  rest: 'Frei nach Dienst (FnD)',
  timeoff: 'Freizeitausgleich (FzA)'
};
export const isDuty = (e: Entry) => !['vacation', 'sick', 'rest', 'timeoff'].includes(e.kind);
/** A night duty's morning phases can coexist with the following free day. */
export function absenceConflicts(a: Entry, b: Entry): boolean {
  if (a.date !== b.date) return false;
  const followsNight = (free: Entry, duty: Entry) =>
    ['rest', 'timeoff'].includes(free.kind) && isDuty(duty) && !!duty.meta?.dutyDate && duty.meta.dutyDate < free.date;
  return !followsNight(a, b) && !followsNight(b, a);
}
export function durationMinutes(e: Entry) {
  return e.meta?.fullDay && e.start === e.end ? 1440 : (minute(e.end) - minute(e.start) + 1440) % 1440;
}
export type Rules = {
  dutyTemplates?: DutyTemplate[];
  holidayCompensated?: boolean;
  hourlyRate: number;
  individualRate: number;
  overtimeBaseRate: number;
  dailyHours: number[];
  nightStart: string;
  nightEnd: string;
  nightPercent: number;
  sundayPercent: number;
  holidayPercent: number;
  overtimePercent: number;
  stacking: 'add' | 'highest';
  holidays: string[];
  openingHours: number;
  openingMonth?: string;
  openingHoursEntered?: boolean;
  confirmed: boolean;
  group: '1' | '2' | '3' | '4';
  tariff: boolean;
  federalState: string;
  localAssumption: boolean;
  localAugsburg: boolean;
  localCorpusChristi: boolean;
  stage?: number;
  nextAdvanceDate?: string;
  rateMode?: 'table' | 'manual';
  workTimeChangeEnabled?: boolean;
  workTimeChangeDate?: string;
  weeklyHoursBefore?: number;
  weeklyHoursAfter?: number;
  optOut?: 'unknown' | 'yes' | 'no';
  optOutWeeklyHours?: number | null;
  /**
   * Earlier versions of the profile, oldest first. Each applies up to and including `validUntil`;
   * the top-level fields apply from the month after the last one. Absent: one profile for all months.
   */
  previous?: RulesVersion[];
};
/** Fields that describe one-off facts or deliberately apply to every month; they are never versioned. */
export const globalRuleKeys = [
  'previous',
  'openingHours',
  'openingMonth',
  'openingHoursEntered',
  'confirmed',
  'dutyTemplates'
] as const;
export type RulesProfile = Omit<Rules, (typeof globalRuleKeys)[number]>;
export type RulesVersion = { validUntil: string; profile: RulesProfile };
export type Settlement = {
  month: string;
  recordedHours: number | null;
  recordedBalance: number | null;
  paidBonus: number | null;
  adjustmentHours: number;
  openingHours: number;
  openingHoursEntered?: boolean;
  openingHoursOrigin?: 'initial' | 'previous' | 'personal';
  openingHoursGap?: string;
  targetHours: number | null;
  overtimeHours: number;
  overtimePaidHours: number;
  extraPay: number;
  note: string;
};
export const defaultRules: Rules = {
  dutyTemplates: [],
  hourlyRate: 0,
  individualRate: 0,
  overtimeBaseRate: 0,
  dailyHours: [0, 8, 8, 8, 8, 8, 0],
  nightStart: '20:00',
  nightEnd: '06:00',
  nightPercent: 20,
  sundayPercent: 25,
  holidayPercent: 35,
  overtimePercent: 15,
  stacking: 'highest',
  holidays: [],
  openingHours: 0,
  openingMonth: '',
  openingHoursEntered: false,
  confirmed: false,
  group: '1',
  tariff: true,
  federalState: '',
  localAssumption: false,
  localAugsburg: false,
  localCorpusChristi: false,
  stage: 1,
  nextAdvanceDate: '',
  rateMode: 'table',
  workTimeChangeEnabled: false,
  workTimeChangeDate: '2026-01-01',
  weeklyHoursBefore: 42,
  weeklyHoursAfter: 40,
  optOut: 'unknown',
  optOutWeeklyHours: null
};
/** Invoke on persisted data before merging defaults: older profiles keep their manual rates. */
export function migrateRules(raw: unknown): Rules {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Ungültiges Profil.');
  const r = raw as Partial<Rules>;
  return {
    ...defaultRules,
    ...r,
    dutyTemplates: r.dutyTemplates ?? [],
    stage: r.stage ?? 1,
    nextAdvanceDate: r.nextAdvanceDate ?? '',
    rateMode: r.rateMode ?? 'manual'
  };
}
export const emptySettlement = (month: string): Settlement => ({
  month,
  recordedHours: null,
  recordedBalance: null,
  paidBonus: null,
  adjustmentHours: 0,
  openingHours: 0,
  openingHoursEntered: false,
  targetHours: null,
  overtimeHours: 0,
  overtimePaidHours: 0,
  extraPay: 0,
  note: ''
});
/** Persisted legacy months already contain an entered opening value, including explicit zero. */
export function migrateSettlement(value: Settlement): Settlement {
  return {
    ...emptySettlement(value.month),
    ...value,
    openingHoursEntered:
      typeof value.openingHoursEntered === 'boolean'
        ? value.openingHoursEntered
        : Object.hasOwn(value, 'openingHours') && Number.isFinite(value.openingHours)
  };
}
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function profileOf(rules: Rules): RulesProfile {
  const profile: Partial<Rules> = { ...rules };
  for (const key of globalRuleKeys) delete profile[key];
  return profile as RulesProfile;
}
const monthBefore = (month: string) => {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 2, 1)).toISOString().slice(0, 7);
};
const monthAfter = (month: string) => {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index, 1)).toISOString().slice(0, 7);
};
/** Index into `previous` of the version in effect for `month`; -1 means the current top-level profile. */
function versionIndex(rules: Rules, month: string) {
  return rules.previous?.findIndex(version => month <= version.validUntil) ?? -1;
}
/** The profile in effect for a month (`YYYY-MM` or a date). Global fields always come from the top level. */
export function rulesAt(rules: Rules, month: string): Rules {
  if (!rules.previous?.length) return rules;
  const index = versionIndex(rules, month.slice(0, 7));
  return index < 0 ? rules : { ...rules, ...rules.previous[index].profile };
}
/**
 * The complete profile in effect for one month, without the version list: what the settings editor
 * shows and what content keys (references, acknowledgements) hash. Without history its JSON equals the
 * stored rules, so keys from before versioning stay valid; with history only the effective profile
 * counts, so editing another version does not invalidate this month's receipts.
 */
export function effectiveRules(rules: Rules, month: string): Rules {
  const { previous: _previous, ...effective } = rulesAt(rules, month);
  return effective;
}
/** First and last month of the version in effect for `month`; null means open-ended. */
export function versionRange(rules: Rules, month: string): { from: string | null; until: string | null } {
  const versions = rules.previous ?? [];
  const index = versionIndex(rules, month);
  const position = index < 0 ? versions.length : index;
  return {
    from: position > 0 ? monthAfter(versions[position - 1].validUntil) : null,
    until: index < 0 ? null : versions[index].validUntil
  };
}
/** Store an edited profile into the version in effect for `month`; global fields apply everywhere. */
export function setRulesAt(rules: Rules, month: string, edited: Rules): Rules {
  const index = versionIndex(rules, month);
  const globals = Object.fromEntries(globalRuleKeys.filter(key => key !== 'previous').map(key => [key, edited[key]]));
  if (index < 0) return { ...edited, ...globals, previous: rules.previous };
  const previous = rules.previous!.map((version, i) =>
    i === index ? { ...version, profile: profileOf(edited) } : version
  );
  return { ...rules, ...globals, previous };
}
/** Start a new version at `month`, initially identical to the profile in effect there. */
export function splitRulesAt(rules: Rules, month: string): Rules {
  if (!validMonth(month)) throw new Error('Ungültiger Monat.');
  const { from } = versionRange(rules, month);
  if (from === month) return rules;
  const until = monthBefore(month);
  const previous = [...(rules.previous ?? []), { validUntil: until, profile: profileOf(rulesAt(rules, month)) }];
  return { ...rules, previous: previous.sort((a, b) => a.validUntil.localeCompare(b.validUntil)) };
}
/** Remove the boundary at `month`: the version starting there then also covers the preceding version's months. */
export function mergeRulesAt(rules: Rules, month: string): Rules {
  const until = monthBefore(month);
  if (!rules.previous?.some(version => version.validUntil === until))
    throw new Error('Für diesen Monat gibt es keine Fassungsgrenze.');
  const previous = rules.previous.filter(version => version.validUntil !== until);
  return { ...rules, previous: previous.length ? previous : undefined };
}
/** Full-time weekly basis for tariff hourly pay, independent of personal part-time hours. */
export function weeklyHours(timeline: Rules, date: string): number {
  if (!validDate(date)) throw new Error('Ungültiges Datum für die Wochenarbeitszeit.');
  const rules = rulesAt(timeline, date);
  if (rules.workTimeChangeEnabled)
    return date < (rules.workTimeChangeDate ?? '2026-01-01')
      ? (rules.weeklyHoursBefore ?? 42)
      : (rules.weeklyHoursAfter ?? 40);
  return date < '2026-01-01' ? 42 : 40;
}
/** dailyHours describes the after-change distribution; optional scaling preserves part-time share. */
export function dailyTargetHours(timeline: Rules, date: string): number {
  if (!validDate(date)) throw new Error('Ungültiges Sollzeitdatum.');
  const rules = rulesAt(timeline, date);
  const base = rules.dailyHours[new Date(date).getUTCDay()];
  return rules.workTimeChangeEnabled ? (base * weeklyHours(rules, date)) / (rules.weeklyHoursAfter ?? 40) : base;
}
export function minute(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Ungültige Uhrzeit.');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
export function validateEntry(raw: unknown): Entry {
  const e = raw as Entry;
  if (!e || !validDate(e.date) || !Object.hasOwn(kinds, e.kind))
    throw new Error('Datum oder Eintragsart ist ungültig.');
  if (typeof e.note !== 'string' || e.note.length > 1000) throw new Error('Notiz ist zu lang.');
  if (isDuty(e)) {
    const duration = durationMinutes(e);
    if (!duration || !Number.isInteger(e.breakMinutes) || e.breakMinutes < 0 || e.breakMinutes >= duration)
      throw new Error(
        'Schicht und Pause müssen eine positive Arbeitszeit ergeben. Für 24 Stunden das entsprechende Feld aktivieren.'
      );
    if (e.kind === 'oncall' && e.breakMinutes) throw new Error('Rufbereitschaft bitte ohne Pausenabzug erfassen.');
    if (e.meta?.pauseStart && e.breakMinutes) {
      const p = (minute(e.meta.pauseStart) - minute(e.start) + 1440) % 1440;
      if (p + e.breakMinutes > duration) throw new Error('Die Pause muss innerhalb des Dienstes liegen.');
    }
  }
  const meta = e.meta ?? {};
  if (
    meta.dutyName !== undefined &&
    (typeof meta.dutyName !== 'string' || !meta.dutyName.trim() || meta.dutyName.length > 100)
  )
    throw new Error('Ungültiger Dienstname.');
  if (meta.dutyDate !== undefined && (typeof meta.dutyDate !== 'string' || !validDate(meta.dutyDate)))
    throw new Error('Ungültiges Dienstdatum.');
  for (const key of ['bdExtraPoints', 'planPercent'] as const)
    if (meta[key] !== undefined && (!Number.isFinite(meta[key]) || meta[key]! < 0 || meta[key]! > 200))
      throw new Error('Zusatzbewertung muss zwischen 0 und 200 liegen.');
  for (const key of ['fullDay', 'holidayCompensated', 'bdTimeOff', 'sickPayEligible', 'vacationPayEligible'] as const)
    if (meta[key] !== undefined && typeof meta[key] !== 'boolean') throw new Error('Ungültige Dienstdetails.');
  if (meta.bdLevel && !['I', 'II'].includes(meta.bdLevel)) throw new Error('Ungültige BD-Stufe.');
  if (meta.pauseStart) minute(meta.pauseStart);
  return {
    date: e.date,
    start: isDuty(e) ? e.start : '',
    end: isDuty(e) ? e.end : '',
    breakMinutes: isDuty(e) ? e.breakMinutes : 0,
    kind: e.kind,
    note: e.note,
    meta
  };
}
export function validateRules(raw: unknown): Rules {
  const r = raw as Rules;
  if (
    !r ||
    !Array.isArray(r.dailyHours) ||
    r.dailyHours.length !== 7 ||
    r.dailyHours.some(v => !Number.isFinite(v) || v < 0 || v > 24)
  )
    throw new Error('Sollstunden müssen für alle sieben Wochentage zwischen 0 und 24 liegen.');
  for (const key of [
    'hourlyRate',
    'individualRate',
    'overtimeBaseRate',
    'nightPercent',
    'sundayPercent',
    'holidayPercent',
    'overtimePercent'
  ] as const)
    if (!Number.isFinite(r[key]) || r[key] < 0 || r[key] > 10000)
      throw new Error('Stundensatz und Zuschläge müssen gültige, positive Zahlen oder null sein.');
  if (!['1', '2', '3', '4'].includes(r.group) || typeof r.tariff !== 'boolean')
    throw new Error('Ungültige Tarifauswahl.');
  const stage = r.stage === undefined ? 1 : r.stage;
  const stageLimit = r.group === '3' ? 4 : r.group === '4' ? 3 : 6;
  if (!Number.isInteger(stage) || stage < 1 || stage > stageLimit)
    throw new Error('Die Stufe ist für die Entgeltgruppe ungültig.');
  if (r.rateMode !== undefined && !['table', 'manual'].includes(r.rateMode))
    throw new Error('Ungültige Auswahl der Stundenentgelte.');
  if (
    r.nextAdvanceDate !== undefined &&
    (typeof r.nextAdvanceDate !== 'string' || (r.nextAdvanceDate !== '' && !validDate(r.nextAdvanceDate)))
  )
    throw new Error('Das nächste Aufstiegsdatum muss ein gültiges Datum sein.');
  if (r.workTimeChangeEnabled !== undefined && typeof r.workTimeChangeEnabled !== 'boolean')
    throw new Error('Ungültige Auswahl der Arbeitszeitänderung.');
  if (
    r.workTimeChangeDate !== undefined &&
    (typeof r.workTimeChangeDate !== 'string' || !validDate(r.workTimeChangeDate))
  )
    throw new Error('Das Arbeitszeitänderungsdatum muss ein gültiges Datum sein.');
  for (const key of ['weeklyHoursBefore', 'weeklyHoursAfter'] as const)
    if (r[key] !== undefined && (!Number.isFinite(r[key]) || r[key]! <= 0 || r[key]! > 168))
      throw new Error('Wochenarbeitszeit muss größer als 0 und höchstens 168 Stunden sein.');
  if (
    r.workTimeChangeEnabled &&
    r.dailyHours.some(
      v => (v * Math.max(r.weeklyHoursBefore ?? 42, r.weeklyHoursAfter ?? 40)) / (r.weeklyHoursAfter ?? 40) > 24
    )
  )
    throw new Error('Die skalierte tägliche Sollzeit darf 24 Stunden nicht überschreiten.');
  if (
    !['', 'BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'].includes(
      r.federalState
    )
  )
    throw new Error('Ungültiges Bundesland.');
  if (r.optOut !== undefined && !['unknown', 'yes', 'no'].includes(r.optOut))
    throw new Error('Ungültige Opt-out-Auswahl.');
  if (
    r.optOutWeeklyHours !== undefined &&
    r.optOutWeeklyHours !== null &&
    (!Number.isFinite(r.optOutWeeklyHours) || r.optOutWeeklyHours <= 0 || r.optOutWeeklyHours > 168)
  )
    throw new Error('Die vereinbarte Opt-out-Grenze muss größer als 0 und höchstens 168 Wochenstunden sein.');
  if (r.confirmed && !r.federalState) throw new Error('Bitte vor der Bestätigung ein Bundesland auswählen.');
  for (const key of ['localAssumption', 'localAugsburg', 'localCorpusChristi'] as const)
    if (typeof r[key] !== 'boolean') throw new Error('Ungültige örtliche Feiertagsauswahl.');
  if (r.holidayCompensated !== undefined && typeof r.holidayCompensated !== 'boolean')
    throw new Error('Ungültiger Feiertagsausgleich.');
  minute(r.nightStart);
  minute(r.nightEnd);
  if (r.nightStart === r.nightEnd) throw new Error('Beginn und Ende der Nachtzeit müssen verschieden sein.');
  if (
    !['add', 'highest'].includes(r.stacking) ||
    !Number.isFinite(r.openingHours) ||
    Math.abs(r.openingHours) > 100000 ||
    typeof r.confirmed !== 'boolean' ||
    !Array.isArray(r.holidays) ||
    r.holidays.length > 1000 ||
    r.holidays.some(d => !validDate(d))
  )
    throw new Error('Regeln oder Feiertagsdaten sind ungültig.');
  if (
    r.openingMonth !== undefined &&
    (typeof r.openingMonth !== 'string' || (r.openingMonth !== '' && !validMonth(r.openingMonth)))
  )
    throw new Error('Der Monat des Anfangsstands ist ungültig.');
  if (r.openingHoursEntered !== undefined && typeof r.openingHoursEntered !== 'boolean')
    throw new Error('Ungültige Angabe zum Anfangsstand.');
  if (r.openingHoursEntered && !r.openingMonth) throw new Error('Bitte den Monat des Anfangsstands angeben.');
  let previous: RulesVersion[] | undefined;
  if (r.previous !== undefined) {
    if (!Array.isArray(r.previous) || r.previous.length > 200) throw new Error('Ungültige frühere Profilfassungen.');
    previous = r.previous.map((version, index) => {
      if (
        !version ||
        typeof version.validUntil !== 'string' ||
        !validMonth(version.validUntil) ||
        (index > 0 && version.validUntil <= r.previous![index - 1].validUntil)
      )
        throw new Error('Frühere Profilfassungen brauchen aufsteigende, gültige Monate.');
      // Each version must itself be a valid profile; global fields come from the current one.
      const { previous: _nested, ...current } = r;
      const checked = validateRules({ ...current, ...version.profile });
      return { validUntil: version.validUntil, profile: profileOf(checked) };
    });
  }
  const validated = migrateRules({
    ...r,
    dutyTemplates: validateDutyTemplates(r.dutyTemplates === undefined ? [] : r.dutyTemplates)
  });
  if (previous?.length) validated.previous = previous;
  else delete validated.previous;
  return validated;
}

export function validMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && validDate(value + '-01');
}
/** Update only the currently editable monthly values; retain historical settlement data. */
export function patchMonthSettings(form: FormData, stored: Settlement): Settlement {
  const month = form.get('month');
  if (typeof month !== 'string' || !validMonth(month) || month !== stored.month) throw new Error('Ungültiger Monat.');
  if (!form.has('note') && !form.has('adjustmentHours')) throw new Error('Keine Monatsangabe vorhanden.');
  const result = { ...stored };
  if (form.has('note')) {
    const note = form.get('note');
    if (typeof note !== 'string' || note.length > 2000) throw new Error('Die Notiz ist ungültig oder zu lang.');
    result.note = note;
  }
  if (form.has('adjustmentHours')) {
    const raw = form.get('adjustmentHours');
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('Bitte eine gültige Korrektur eingeben.');
    const value = Number(raw.trim().replace(',', '.'));
    if (!Number.isFinite(value) || Math.abs(value) > 1000000) throw new Error('Bitte eine gültige Korrektur eingeben.');
    result.adjustmentHours = value;
  }
  return result;
}
