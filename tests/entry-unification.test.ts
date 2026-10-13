import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, percentageRate } from '../src/lib/calculate';
import { configuredEntry, dutyEntries, dutyEntriesFromForm } from '../src/lib/duty-entry';
import {
  absenceConflicts,
  defaultRules,
  emptySettlement,
  isDuty,
  validateEntry,
  validateRules,
  type Entry
} from '../src/lib/model';

const night = {
  name: 'N/B/N',
  regularHours: 5,
  standbyHours: 4,
  secondRegularHours: 1.25,
  bdLevel: 'II' as const,
  bdTimeOff: true,
  times: { start: '21:45', regularEnd: '02:45', standbyEnd: '06:45', end: '08:00' }
};
const profile = {
  ...defaultRules,
  federalState: 'BE',
  rateMode: 'manual' as const,
  individualRate: 50,
  hourlyRate: 50,
  overtimeBaseRate: 50
};
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('FnD and FzA retain weekday targets, give no work/absence credit or pay, and fill missing days', () => {
  for (const kind of ['rest', 'timeoff'] as const) {
    const entry = validateEntry({ date: '2026-09-14', kind, start: '07:00', end: '15:00', breakMinutes: 30, note: '' });
    assert.equal(entry.start, '');
    assert.equal(entry.end, '');
    assert.equal(entry.breakMinutes, 0);
    assert.equal(isDuty(entry), false);
    const result = calculate([entry], profile, '2026-09', emptySettlement('2026-09'));
    assert.equal(result.target, 176);
    assert.equal(result.actual, 0);
    assert.equal(result.credited, 0);
    assert.equal(result.expectedPay, 0);
    assert.equal(result.delta, -176);
    assert.ok(!result.missing.includes(entry.date));
  }
});

test('FnD can coexist with morning phases of the previous night, but not a new daytime duty', () => {
  const free = validateEntry({ date: '2026-09-12', kind: 'rest', start: '', end: '', breakMinutes: 0, note: '' });
  const phases = dutyEntries(night, '2026-09-11', '21:45', '08:00');
  for (const phase of phases) {
    assert.equal(absenceConflicts(free, phase), false);
    assert.equal(absenceConflicts(phase, free), false);
  }
  assert.equal(absenceConflicts(free, { ...phases[2], meta: {} }), true);
  assert.equal(absenceConflicts(free, { ...free, kind: 'vacation' }), true);
});

test('September legacy BD entries inherit their named service allocation; explicit paid values win', () => {
  const paid = { ...night, name: 'N2/B2', bdTimeOff: false };
  const rules = { ...profile, dutyTemplates: [night, paid] };
  const first: Entry = {
    date: '2026-09-12',
    start: '02:45',
    end: '06:45',
    breakMinutes: 0,
    kind: 'standby',
    note: 'N/B/N',
    meta: {}
  };
  const second: Entry = { ...first, date: '2026-09-13', note: 'N2/B2', meta: { dutyName: 'N2/B2' } };
  const before = structuredClone([first, second]);
  const result = calculate([first, second], rules, '2026-09', emptySettlement('2026-09'));
  close(result.standbyCredit, 3.8);
  close(result.standbyPaidHours, 3.8);
  assert.equal(result.dutyPay, 190);
  close(result.balance, 3.8 - result.target);
  assert.deepEqual([first, second], before);
  assert.equal(configuredEntry({ ...first, meta: { bdTimeOff: false, bdLevel: 'I' } }, rules).meta?.bdTimeOff, false);
  assert.equal(configuredEntry({ ...first, note: 'Unbekannt' }, rules).meta?.bdTimeOff, undefined);
  assert.equal(
    configuredEntry(first, { ...rules, dutyTemplates: [night, { ...night, bdTimeOff: false }] }).meta?.bdTimeOff,
    undefined
  );
});

test('unified configured form carries extras and distributes exact pause minutes across midnight phases', () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    duty: '0',
    date: '2026-09-11',
    start: '21:45',
    end: '08:00',
    breakMinutes: '30',
    note: 'Diensttausch',
    meta: JSON.stringify({ bdExtraPoints: 10, planPercent: 20 })
  }))
    form.set(key, value);
  const rows = dutyEntriesFromForm(form, { ...profile, dutyTemplates: [night] });
  assert.equal(
    rows.reduce((sum, entry) => sum + entry.breakMinutes, 0),
    30
  );
  assert.ok(rows.every(entry => entry.note === 'Diensttausch' && entry.meta?.dutyName === night.name));
  assert.equal(rows[1].meta?.bdExtraPoints, 10);
  assert.equal(rows[1].meta?.planPercent, undefined);
  assert.equal(rows[0].meta?.planPercent, 20);
  assert.equal(rows[0].meta?.bdExtraPoints, undefined);
  const result = calculate(rows, profile, '2026-09', emptySettlement('2026-09'));
  close(result.actual, 9.75);
  assert.ok(result.standbyCredit > 0);
  form.set('breakMinutes', '700');
  assert.throws(() => dutyEntriesFromForm(form, { ...profile, dutyTemplates: [night] }));
});

test('changing a configured duty to FZA recalculates existing September hours using the level factor', () => {
  const template = {
    name: 'BD-FZA',
    regularHours: 0,
    standbyHours: 20.25,
    secondRegularHours: 0,
    bdLevel: 'II' as const,
    bdTimeOff: true
  };
  const entries = dutyEntries({ ...template, bdLevel: 'I', bdTimeOff: false }, '2026-09-11', '00:00', '20:15');
  const original = structuredClone(entries);
  const rules = { ...profile, dutyTemplates: [template] };
  const result = calculate(entries, rules, '2026-09', emptySettlement('2026-09'));
  close(result.standbyCredit, 20.25 * 0.95);
  assert.equal(result.standbyPaidHours, 0);
  assert.equal(result.dutyPay, 0);
  close(result.balance, result.regular + result.credited + 20.25 * 0.95 - result.target);
  assert.deepEqual(entries, original, 'recalculation does not rewrite recorded entries');
  const paid = calculate(
    entries,
    { ...rules, dutyTemplates: [{ ...template, bdTimeOff: false }] },
    '2026-09',
    emptySettlement('2026-09')
  );
  assert.equal(paid.standbyCredit, 0);
  close(paid.standbyPaidHours, 20.25 * 0.95);
});

test('holiday compensation comes from settings while explicit historical entry values remain authoritative', () => {
  const entry: Entry = {
    date: '2026-10-03',
    start: '12:00',
    end: '14:00',
    kind: 'work',
    note: '',
    breakMinutes: 0,
    meta: {}
  };
  const rules = validateRules({ ...profile, holidayCompensated: false });
  const result = calculate([entry], rules, '2026-10', emptySettlement('2026-10'));
  assert.equal(result.expectedBonus, 2 * percentageRate(result.rate, 135));
  assert.equal(
    calculate([{ ...entry, meta: { holidayCompensated: true } }], rules, '2026-10', emptySettlement('2026-10'))
      .expectedBonus,
    2 * percentageRate(result.rate, 35)
  );
  assert.throws(() => validateRules({ ...rules, holidayCompensated: 'false' }));
});
