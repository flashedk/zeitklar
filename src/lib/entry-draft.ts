import type { Entry } from './model';

export function currentDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

/** Default values for a new time-tracking entry. */
export function freshEntry(date = currentDay()): Entry {
  return { date, start: '07:00', end: '15:30', breakMinutes: 30, kind: 'work', note: '', meta: {} };
}
