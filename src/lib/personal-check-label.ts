import { validDate, type Entry } from './model';
import type { AuditCheck, TimeReport } from './report';

/** Label the service context without changing the check's saved acknowledgement identity. */
export function personalCheckLabel(
  check: Pick<AuditCheck, 'title'>,
  entries: Entry[],
  report: TimeReport | null
): string {
  const date = check.title.slice(0, 10);
  if (!validDate(date)) return check.title;
  const work = entries.filter(entry => entry.kind === 'work' && entry.date === date);
  const related = entries.filter(
    entry =>
      entry.date === date ||
      work.some(
        phase =>
          phase.meta?.dutyDate &&
          phase.meta.dutyDate === entry.meta?.dutyDate &&
          phase.meta.dutyName === entry.meta?.dutyName
      )
  );
  const day = report?.days.find(day => day.date === date);
  const source = day
    ? [day.label, ...day.rawLines, ...day.spans.flatMap(span => [span.label, span.raw])].join(' ')
    : '';
  const standby =
    related.some(entry => entry.kind === 'standby') ||
    (day?.standbyHours ?? 0) > 0 ||
    day?.spans.some(span => span.kind === 'standby') ||
    /\bBD(?:[-_. ]|$)|\bBereitschaftsdienst\b/i.test(source);
  const label = standby
    ? 'Bereitschaftsdienst'
    : related.some(entry => entry.kind === 'callout')
      ? 'Ruf-Einsatz'
      : related.some(entry => entry.kind === 'oncall')
        ? 'Rufbereitschaft'
        : 'Regeldienst';
  return `${date}: ${label}`;
}
