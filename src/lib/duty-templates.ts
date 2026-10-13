export type DutyTemplate = {
  name: string;
  regularHours: number;
  standbyHours: number;
  secondRegularHours: number;
  bdLevel: 'I' | 'II';
  bdTimeOff?: boolean;
  times?: { start: string; regularEnd: string; standbyEnd: string; end: string };
};

export const emptyDutyTemplate = (): DutyTemplate => ({
  name: '',
  regularHours: 0,
  standbyHours: 0,
  secondRegularHours: 0,
  bdLevel: 'I'
});

/** The editor's empty row is never persisted as a configured duty. */
export function isEmptyDutyTemplate(duty: DutyTemplate): boolean {
  return (
    !duty.name.trim() &&
    duty.regularHours === 0 &&
    duty.standbyHours === 0 &&
    duty.secondRegularHours === 0 &&
    (!duty.times || Object.values(duty.times).every(value => value === ''))
  );
}

export function clockMinute(value: string): number {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error('Bitte eine gültige Uhrzeit eingeben.');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

export function dutyPhaseMinutes(duty: DutyTemplate): number[] {
  if (!duty.times)
    return [duty.regularHours, duty.standbyHours, duty.secondRegularHours].map(hours => Math.round(hours * 60));
  const times = duty.times;
  const start = clockMinute(times.start),
    regularEnd = clockMinute(times.regularEnd);
  const standbyEnd = times.standbyEnd === '' ? regularEnd : clockMinute(times.standbyEnd);
  const end = times.end === '' ? standbyEnd : clockMinute(times.end);
  const duration = (from: number, to: number) => (to - from + 1440) % 1440;
  const phases = [duration(start, regularEnd), duration(regularEnd, standbyEnd), duration(standbyEnd, end)];
  // An equal start/end with no other phases represents a full regular day.
  if (!phases.some(Boolean) && start === regularEnd && !times.standbyEnd && !times.end) phases[0] = 1440;
  return phases;
}

export function dutyDefaultTimes(duty: DutyTemplate): { start: string; end: string } | null {
  if (!duty.times) return null;
  return { start: duty.times.start, end: duty.times.end || duty.times.standbyEnd || duty.times.regularEnd };
}

export function validateDutyTemplate(raw: unknown): DutyTemplate {
  const duty = raw as DutyTemplate;
  if (!duty || typeof duty.name !== 'string' || !duty.name.trim() || duty.name.length > 100)
    throw new Error('Bitte für jeden Dienst einen Namen mit höchstens 100 Zeichen eingeben.');
  for (const key of ['regularHours', 'standbyHours', 'secondRegularHours'] as const) {
    if (!Number.isFinite(duty[key]) || duty[key] < 0 || duty[key] > 24)
      throw new Error(`Dienst „${duty.name}“: Jede Dauer muss zwischen 0 und 24 Stunden liegen.`);
  }
  const phases = dutyPhaseMinutes(duty);
  const total = phases.reduce((sum, value) => sum + value, 0) / 60;
  if (total <= 0 || total > 24)
    throw new Error(`Dienst „${duty.name}“: Die Gesamtdauer muss größer als 0 und höchstens 24 Stunden sein.`);
  if (!['I', 'II'].includes(duty.bdLevel))
    throw new Error(`Dienst „${duty.name}“: Bitte Bereitschaftsstufe I oder II auswählen.`);
  if (duty.bdTimeOff !== undefined && typeof duty.bdTimeOff !== 'boolean')
    throw new Error(`Dienst „${duty.name}“: Ungültiger BD-Ausgleich.`);
  return {
    name: duty.name,
    regularHours: phases[0] / 60,
    standbyHours: phases[1] / 60,
    secondRegularHours: phases[2] / 60,
    bdLevel: duty.bdLevel,
    ...(duty.bdTimeOff !== undefined ? { bdTimeOff: duty.bdTimeOff } : {}),
    ...(duty.times ? { times: { ...duty.times } } : {})
  };
}

export function isCompleteDutyTemplate(duty: DutyTemplate): boolean {
  try {
    validateDutyTemplate(duty);
    return true;
  } catch {
    return false;
  }
}

export function validateDutyTemplates(raw: unknown): DutyTemplate[] {
  if (!Array.isArray(raw)) throw new Error('Die Dienstkonfiguration muss eine Liste sein.');
  return raw.map(validateDutyTemplate);
}
