import { clockMinute, dutyPhaseMinutes, validateDutyTemplate, type DutyTemplate } from './duty-templates';
import { durationMinutes, validDate, validateEntry, type Entry, type EntryMeta, type Rules } from './model';

/** Template-based duties use the current configuration; manual overrides remain authoritative. */
export function configuredEntry(entry: Entry, rules: Rules): Entry {
  const name = entry.meta?.dutyName ?? entry.note;
  const matches = rules.dutyTemplates?.filter(duty => duty.name.trim() === name.trim()) ?? [];
  if (entry.kind !== 'standby' || matches.length !== 1) return entry;
  const duty = matches[0];
  if (entry.meta?.dutyDate)
    return {
      ...entry,
      meta: { ...entry.meta, bdLevel: duty.bdLevel, bdTimeOff: duty.bdTimeOff ?? entry.meta.bdTimeOff }
    };
  return {
    ...entry,
    meta: {
      ...entry.meta,
      bdLevel: entry.meta?.bdLevel ?? duty.bdLevel,
      ...((entry.meta?.bdTimeOff ?? duty.bdTimeOff) !== undefined
        ? { bdTimeOff: entry.meta?.bdTimeOff ?? duty.bdTimeOff }
        : {})
    }
  };
}

/** Split actual attendance at the configured phase boundaries; never count overlapping phases. */
export function dutyEntries(template: DutyTemplate, date: string, start: string, end: string): Entry[] {
  const duty = validateDutyTemplate(template);
  if (!validDate(date)) throw new Error('Bitte ein gültiges Dienstdatum auswählen.');
  const arrival = clockMinute(start),
    departure = clockMinute(end);
  const phases = dutyPhaseMinutes(duty),
    total = phases.reduce((sum, value) => sum + value, 0);
  const actualEnd = arrival + ((departure - arrival + 1440) % 1440 || (total === 1440 ? 1440 : 0));
  if (actualEnd === arrival) throw new Error('Start und Ende müssen verschieden sein.');
  // Fixed clock boundaries stay fixed when the actual arrival differs from the plan.
  const plannedStart = duty.times
    ? arrival + (((clockMinute(duty.times.start) - arrival + 2160) % 1440) - 720)
    : arrival;
  const active = phases
    .map((duration, i) => ({ duration, kind: i === 1 ? ('standby' as const) : ('work' as const) }))
    .filter(phase => phase.duration > 0);
  let boundary = plannedStart;
  const rows: Entry[] = [];
  const midnight = Date.parse(date);
  const time = (minute: number) =>
    `${String(Math.floor((((minute % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((minute % 60) + 60) % 60).padStart(2, '0')}`;
  for (const [i, phase] of active.entries()) {
    const from = Math.max(arrival, i === 0 ? arrival : boundary);
    boundary += phase.duration;
    const to = Math.min(actualEnd, i === active.length - 1 ? actualEnd : boundary);
    if (to <= from) continue;
    rows.push(
      validateEntry({
        date: new Date(midnight + Math.floor(from / 1440) * 86400000).toISOString().slice(0, 10),
        start: time(from),
        end: time(to),
        breakMinutes: 0,
        kind: phase.kind,
        note: duty.name,
        meta: {
          dutyName: duty.name,
          dutyDate: date,
          ...(phase.kind === 'standby'
            ? { bdLevel: duty.bdLevel, ...(duty.bdTimeOff !== undefined ? { bdTimeOff: duty.bdTimeOff } : {}) }
            : {}),
          ...(to - from === 1440 ? { fullDay: true } : {})
        }
      })
    );
  }
  return rows;
}

export function dutyEntriesFromForm(form: FormData, rules: Rules): Entry[] {
  const index = Number(form.get('duty'));
  if (!form.has('duty') || String(form.get('duty')).trim() === '' || !Number.isSafeInteger(index) || index < 0)
    throw new Error('Bitte einen konfigurierten Dienst auswählen.');
  const template = rules.dutyTemplates?.[index];
  if (!template) throw new Error('Dieser Dienst ist nicht mehr konfiguriert. Bitte neu auswählen.');
  const rows = dutyEntries(template, String(form.get('date')), String(form.get('start')), String(form.get('end')));
  const meta: EntryMeta = JSON.parse(String(form.get('meta') || '{}'));
  const pause = Number(form.get('breakMinutes') ?? 0);
  const total = rows.reduce((sum, row) => sum + durationMinutes(row), 0);
  if (!Number.isInteger(pause) || pause < 0 || pause >= total)
    throw new Error('Die Pause muss kürzer als der Dienst sein.');
  // Spread minutes across phases while preserving the exact entered pause total.
  let allocated = 0,
    elapsed = 0;
  return rows.map(row => {
    elapsed += durationMinutes(row);
    const cumulative = Math.round((pause * elapsed) / total);
    const breakMinutes = cumulative - allocated;
    allocated = cumulative;
    return validateEntry({
      ...row,
      breakMinutes,
      note: String(form.get('note') || template.name),
      meta: {
        ...row.meta,
        ...(meta.bdExtraPoints !== undefined && row.kind === 'standby' ? { bdExtraPoints: meta.bdExtraPoints } : {}),
        ...(meta.planPercent !== undefined && row.kind === 'work' ? { planPercent: meta.planPercent } : {})
      }
    });
  });
}
