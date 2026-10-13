import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarBlocks, calendarSpans } from '../src/lib/calendar-spans';
import { dutyEntries } from '../src/lib/duty-entry';
import { calculate } from '../src/lib/calculate';
import { defaultRules, emptySettlement } from '../src/lib/model';
import type { ReportSpan } from '../src/lib/report';
import type { Entry } from '../src/lib/model';

const date = '2026-06-16';
const spans: ReportSpan[] = [
  { start: '02:45', end: '06:45', label: 'BD-St.II-FZA.TVÄ', kind: 'unknown', raw: 'BD source' },
  { start: '21:45', end: '08:00', label: 'Di', kind: 'unknown', raw: 'Night source' }
];
const night = {
  name: 'N/B/N',
  regularHours: 5,
  standbyHours: 4,
  secondRegularHours: 1.25,
  bdLevel: 'II' as const,
  times: { start: '21:45', regularEnd: '02:45', standbyEnd: '06:45', end: '08:00' }
};

test('recording an overnight mixed duty resolves both unknown DPL blocks and displays BD level II', () => {
  const original = structuredClone(spans);
  const result = calendarSpans(date, spans, dutyEntries(night, date, '21:45', '08:00'));
  assert.deepEqual(
    result.map(span => [span.kind, span.resolved, span.displayLabel]),
    [
      ['standby', true, 'BD · Stufe II'],
      ['mixed', true, 'N/B/N']
    ]
  );
  assert.match(result[1].description, /Regelarbeitszeit \+ Bereitschaftsdienst · Stufe II/);
  assert.deepEqual(spans, original, 'imported report values remain unchanged');
});

test('earlier arrivals and later departures still resolve matching planned intervals', () => {
  const result = calendarSpans(date, spans, dutyEntries(night, date, '21:30', '08:30'));
  assert.ok(result.every(span => span.resolved));
});

test('removing a recorded duty makes its unmatched report blocks unknown again', () => {
  assert.ok(calendarSpans(date, spans, []).every(span => span.kind === 'unknown' && !span.resolved));
  assert.ok(
    calendarSpans(date, spans, dutyEntries(night, '2026-06-17', '21:45', '08:00')).every(span => !span.resolved)
  );
});

test('a partial diary or a regular-only entry cannot falsely resolve a readiness block', () => {
  const rows = dutyEntries(night, date, '21:45', '08:00');
  const result = calendarSpans(date, spans, rows.slice(0, 2));
  assert.equal(result[0].resolved, true);
  assert.equal(result[1].resolved, false);
  const work: Entry = { date, start: '21:45', end: '08:00', breakMinutes: 0, kind: 'work', note: '' };
  assert.equal(calendarSpans(date, spans, [work])[0].resolved, false);
});

test('conflicting overlapping entries remain unknown and existing source classifications stay intact', () => {
  const rows = dutyEntries(night, date, '21:45', '08:00');
  const overlapping = { ...rows[1], kind: 'work' as const };
  assert.ok(calendarSpans(date, spans, [...rows, overlapping]).every(span => !span.resolved));
  const known = { ...spans[0], kind: 'standby' as const };
  assert.equal(calendarSpans(date, [known], rows)[0].resolved, false);
  assert.equal(calendarSpans(date, [known], rows)[0].kind, 'standby');
});

test('24:00 source endpoints resolve against independently recorded work', () => {
  const span: ReportSpan = { start: '13:30', end: '24:00', label: 'Mo', kind: 'unknown', raw: '' };
  const work: Entry = { date, start: '13:30', end: '00:00', breakMinutes: 0, kind: 'work', note: '' };
  assert.equal(calendarSpans(date, [span], [work])[0].kind, 'work');
});

test('the calendar keeps only the yellow BD block and the named duty after recording all phases', () => {
  const entries = dutyEntries(night, date, '21:45', '08:00');
  const original = structuredClone({ spans, entries });
  const blocks = calendarBlocks(date, spans, entries);
  assert.deepEqual(
    blocks.map(block => [block.displayLabel, block.start, block.end, block.standby, block.source]),
    [
      ['BD · Stufe II', '02:45', '06:45', true, 'employer'],
      ['N/B/N', '21:45', '08:00', false, 'employer']
    ]
  );
  assert.ok(blocks.every(block => !block.unknown));
  assert.deepEqual({ spans, entries }, original, 'individual phases remain available for calculations and editing');
});

test('already classified report blocks also suppress matching duplicate diary entries', () => {
  const source = spans.map(span => ({
    ...span,
    kind: span.label.startsWith('BD') ? ('standby' as const) : ('work' as const)
  }));
  const blocks = calendarBlocks(date, source, dutyEntries(night, date, '21:45', '08:00'));
  assert.equal(blocks.length, 2);
  assert.ok(blocks.every(block => block.source === 'employer'));
});

test('a recorded duty without an employer report stays visible and unrelated entries are retained', () => {
  const entries = dutyEntries(night, date, '21:45', '08:00');
  const withoutReport = calendarBlocks(date, [], entries);
  assert.deepEqual(
    withoutReport.map(block => [block.displayLabel, block.start, block.end, block.standby, block.source]),
    [
      ['BD · Stufe II', '02:45', '06:45', true, 'recorded'],
      ['N/B/N', '21:45', '08:00', false, 'recorded']
    ]
  );
  const additional: Entry = { date, start: '09:00', end: '12:00', breakMinutes: 0, kind: 'work', note: '' };
  const blocks = calendarBlocks(date, spans, [...entries, additional]);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[2].start, '09:00');
  assert.equal(calendarBlocks(date, spans, [additional]).length, 3);
});

test('own N/B/N on September 25 displays the exact readiness window and credits only four BD hours', () => {
  const recordedDate = '2026-09-25';
  const entries = dutyEntries({ ...night, bdTimeOff: true }, recordedDate, '21:45', '08:00');
  const original = structuredClone(entries);
  const withoutReport = calendarBlocks(recordedDate, [], entries);
  const withReport = calendarBlocks(recordedDate, spans, entries);
  const display = (blocks: ReturnType<typeof calendarBlocks>) =>
    blocks.map(({ start, end, displayLabel, standby }) => ({ start, end, displayLabel, standby }));
  assert.deepEqual(display(withoutReport), display(withReport));
  const result = calculate(entries, defaultRules, '2026-09', emptySettlement('2026-09'));
  const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8);
  close(result.regular, 6.25);
  close(
    result.rows.filter(entry => entry.kind === 'standby').reduce((sum, entry) => sum + entry.worked, 0),
    4
  );
  close(result.standbyCredit, 4 * 0.95);
  assert.equal(result.standbyPaidHours, 0);
  assert.deepEqual(entries, original, 'calendar rendering does not alter the calculation inputs');
});
