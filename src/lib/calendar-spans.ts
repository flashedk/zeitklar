import { durationMinutes, kinds, minute, type Entry } from './model';
import type { ReportSpan } from './report';

export type CalendarSpan = Omit<ReportSpan, 'kind'> & {
  kind: ReportSpan['kind'] | 'mixed';
  resolved: boolean;
  displayLabel: string;
  description: string;
};

/** Resolve calendar labels from matching diary intervals without changing the imported report. */
export function calendarSpans(date: string, spans: ReportSpan[], entries: Entry[]): CalendarSpan[] {
  const origin = Date.parse(date);
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (!['work', 'standby'].includes(entry.kind) || (entry.meta?.dutyDate ?? entry.date) !== date) continue;
    const key = entry.meta?.dutyName ?? 'manual';
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return spans.map(span => {
    const original: CalendarSpan = {
      ...span,
      resolved: false,
      displayLabel: span.kind === 'unknown' ? 'Ungeklärt' : span.kind === 'standby' ? 'BD' : span.label || 'Dienst',
      description:
        span.kind === 'unknown'
          ? 'Dienstart ungeklärt'
          : span.kind === 'standby'
            ? 'Bereitschaftsdienst'
            : 'Regeldienst'
    };
    if (span.kind !== 'unknown') return original;
    const start = minute(span.start),
      end = span.end === '24:00' ? 1440 : minute(span.end);
    const duration = (end - start + 1440) % 1440 || 1440;
    const standbyOnly = /\bBD[- .]|Bereitschaft/i.test(span.label);
    const matches: Entry[][] = [];
    for (const group of groups.values()) {
      const intervals = group.map(entry => {
        const from = (Date.parse(entry.date) - origin) / 60000 + minute(entry.start);
        return { entry, from, to: from + durationMinutes(entry) };
      });
      // DPL prints the overnight BD block under the service's starting date.
      for (const from of [start, start + 1440]) {
        const to = from + duration;
        const relevant = intervals
          .filter(interval => interval.from < to && interval.to > from)
          .sort((a, b) => a.from - b.from);
        let covered = from;
        let valid = relevant.length > 0;
        for (const interval of relevant) {
          const left = Math.max(from, interval.from),
            right = Math.min(to, interval.to);
          if (left !== covered || (standbyOnly && interval.entry.kind !== 'standby')) {
            valid = false;
            break;
          }
          covered = right;
        }
        if (valid && covered === to) {
          matches.push(relevant.map(interval => interval.entry));
          break;
        }
      }
    }
    if (matches.length !== 1) return original;
    const matched = matches[0];
    const kinds = new Set(matched.map(entry => entry.kind));
    const kind = kinds.size > 1 ? 'mixed' : (matched[0].kind as 'work' | 'standby');
    const levels = [
      ...new Set(
        matched
          .filter(entry => entry.kind === 'standby')
          .map(entry => entry.meta?.bdLevel)
          .filter(Boolean)
      )
    ];
    const level = levels.length === 1 ? ` · Stufe ${levels[0]}` : '';
    const dutyName = matched[0].meta?.dutyName;
    const description =
      kind === 'mixed'
        ? `Regelarbeitszeit + Bereitschaftsdienst${level}`
        : kind === 'standby'
          ? `Bereitschaftsdienst${level}`
          : 'Regelarbeitszeit';
    return {
      ...span,
      kind,
      resolved: true,
      displayLabel:
        kind === 'standby' ? `BD${level}` : dutyName || (kind === 'mixed' ? 'Regeldienst + BD' : 'Regeldienst'),
      description: `${description} · aus eigenem Dienst zugeordnet`
    };
  });
}

export type CalendarBlock = {
  start: string;
  end: string;
  displayLabel: string;
  standby: boolean;
  unknown: boolean;
  source: 'employer' | 'personal' | 'recorded';
};

/** Keep the source's duty and BD blocks, omitting duplicate diary phases after matching. */
export function calendarBlocks(date: string, spans: ReportSpan[], entries: Entry[]): CalendarBlock[] {
  const own = entries.filter(entry => (entry.meta?.dutyDate ?? entry.date) === date);
  const origin = Date.parse(date) / 60000;
  const startOf = (entry: Entry) => Date.parse(entry.date) / 60000 + (entry.start ? minute(entry.start) : 0);
  const matches = calendarSpans(
    date,
    spans.map(span => ({ ...span, kind: 'unknown' })),
    entries
  );
  const represented = (entry: Entry) =>
    ['work', 'standby'].includes(entry.kind) &&
    spans.some((span, index) => {
      if (!matches[index].resolved) return false;
      const start = minute(span.start),
        end = span.end === '24:00' ? 1440 : minute(span.end);
      const duration = (end - start + 1440) % 1440 || 1440;
      const entryStart = startOf(entry) - origin,
        entryEnd = entryStart + durationMinutes(entry);
      return [start, start + 1440].some(from => from < entryEnd && from + duration > entryStart);
    });
  const sorted = own.filter(entry => !represented(entry)).sort((a, b) => startOf(a) - startOf(b));
  const groups: Entry[][] = [];
  for (const entry of sorted) {
    const previous = groups.at(-1)?.at(-1);
    if (
      previous?.meta?.dutyName &&
      entry.meta?.dutyName === previous.meta.dutyName &&
      ['work', 'standby'].includes(entry.kind) &&
      ['work', 'standby'].includes(previous.kind) &&
      startOf(previous) + durationMinutes(previous) === startOf(entry)
    ) {
      groups[groups.length - 1].push(entry);
    } else groups.push([entry]);
  }
  const resolved = calendarSpans(date, spans, entries);
  const employer: CalendarBlock[] = resolved.map(span => ({
    start: span.start,
    end: span.end,
    displayLabel: span.displayLabel,
    standby: span.kind === 'standby',
    unknown: span.kind === 'unknown',
    source: 'employer'
  }));
  const personal: CalendarBlock[] = groups.flatMap(group => {
    const first = group[0],
      last = group[group.length - 1];
    const source = first.meta?.dutyName ? ('recorded' as const) : ('personal' as const);
    const hasRegular = group.some(entry => entry.kind === 'work');
    const readiness = group.filter(entry => entry.kind === 'standby');
    const main: CalendarBlock = {
      start: first.start,
      end: last.end,
      displayLabel: first.meta?.dutyName ?? kinds[first.kind],
      standby: !hasRegular && readiness.length > 0,
      unknown: false,
      source
    };
    if (!hasRegular || !readiness.length) return [main];
    // Show the same BD detail + overall duty as the report, without changing recorded phases.
    return [
      ...readiness.map(entry => ({
        start: entry.start,
        end: entry.end,
        displayLabel: `BD${entry.meta?.bdLevel ? ` · Stufe ${entry.meta.bdLevel}` : ''}`,
        standby: true,
        unknown: false,
        source
      })),
      main
    ];
  });
  return [...employer, ...personal];
}
