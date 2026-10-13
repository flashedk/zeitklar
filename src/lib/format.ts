import { euro, hours } from './calculate';

export const statHours = (n: number | null) => (n == null ? '—' : hours(n));
export const statCount = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(n);
export const value = (n: number | null | undefined, unit = 'h') =>
  n == null ? '—' : unit === 'EUR' ? euro(n) : `${hours(n)}${unit === 'h' ? ' h' : ''}`;
export const rateLabel = (rate: number | null) => (rate == null ? 'Tarifgrundlage fehlt' : `${euro(rate)} / h`);
export const monthLabel = (m: string) =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(m)
    ? new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${m}-01T12:00:00Z`)
      )
    : 'Datum prüfen';
export const dateLabel = (d: string) =>
  d && !isNaN(Date.parse(`${d}T12:00:00Z`))
    ? new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${d}T12:00:00Z`)
      )
    : '—';
export const acknowledgmentLabel = (date: string) =>
  !isNaN(Date.parse(date))
    ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(
        new Date(date)
      )
    : date;
