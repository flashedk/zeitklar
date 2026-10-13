import test from 'node:test';
import assert from 'node:assert/strict';
import { dutyEntries, dutyEntriesFromForm } from '../src/lib/duty-entry';
import { validateDutyTemplate, type DutyTemplate } from '../src/lib/duty-templates';
import { defaultRules, durationMinutes, emptySettlement } from '../src/lib/model';
import { calculate } from '../src/lib/calculate';

const night: DutyTemplate = {
  name: 'N',
  regularHours: 0,
  standbyHours: 0,
  secondRegularHours: 0,
  bdLevel: 'II',
  times: { start: '21:45', regularEnd: '02:45', standbyEnd: '06:45', end: '08:00' }
};

test('N stores exact clock phases and the correct dates and BD level across midnight', () => {
  const duty = validateDutyTemplate(night);
  assert.equal(duty.regularHours, 5);
  assert.equal(duty.standbyHours, 4);
  assert.equal(duty.secondRegularHours, 1.25);
  const rows = dutyEntries(night, '2026-06-16', '21:45', '08:00');
  assert.deepEqual(
    rows.map(e => [e.date, e.start, e.end, e.kind, e.meta?.bdLevel]),
    [
      ['2026-06-16', '21:45', '02:45', 'work', undefined],
      ['2026-06-17', '02:45', '06:45', 'standby', 'II'],
      ['2026-06-17', '06:45', '08:00', 'work', undefined]
    ]
  );
  assert.ok(rows.every(e => e.breakMinutes === 0 && e.meta?.dutyDate === '2026-06-16' && e.meta?.dutyName === 'N'));
  const result = calculate(rows, defaultRules, '2026-06', emptySettlement('2026-06'));
  assert.ok(Math.abs(result.regular - 6.25) < 1e-9);
  assert.ok(Math.abs(result.rows.filter(e => e.kind === 'standby').reduce((sum, e) => sum + e.worked, 0) - 4) < 1e-9);
});

test('actual attendance adjusts outer phases while fixed readiness boundaries stay fixed', () => {
  const rows = dutyEntries(night, '2026-06-16', '21:30', '08:30');
  assert.deepEqual(
    rows.map(e => [e.start, e.end]),
    [
      ['21:30', '02:45'],
      ['02:45', '06:45'],
      ['06:45', '08:30']
    ]
  );
  const late = dutyEntries(night, '2026-06-17', '03:00', '07:00');
  assert.deepEqual(
    late.map(e => [e.start, e.end, e.kind]),
    [
      ['03:00', '06:45', 'standby'],
      ['06:45', '07:00', 'work']
    ]
  );
  const early = dutyEntries(night, '2026-06-16', '21:45', '02:00');
  assert.equal(early.length, 1);
  assert.equal(early[0].end, '02:00');
});

test('duration-only legacy services still split by duration and clip to actual departure', () => {
  const legacy: DutyTemplate = {
    name: 'Alt',
    regularHours: 5,
    standbyHours: 4,
    secondRegularHours: 1.25,
    bdLevel: 'I'
  };
  const rows = dutyEntries(legacy, '2026-06-16', '21:45', '07:30');
  assert.deepEqual(
    rows.map(e => [e.start, e.end]),
    [
      ['21:45', '02:45'],
      ['02:45', '06:45'],
      ['06:45', '07:30']
    ]
  );
});

test('month boundary retains real dates and credits regular time in the correct month', () => {
  const rows = dutyEntries(night, '2026-06-30', '21:45', '08:00');
  assert.equal(rows[1].date, '2026-07-01');
  assert.ok(Math.abs(calculate(rows, defaultRules, '2026-06', emptySettlement('2026-06')).regular - 2.25) < 1e-9);
  assert.ok(Math.abs(calculate(rows, defaultRules, '2026-07', emptySettlement('2026-07')).regular - 4) < 1e-9);
});

test('single phase, BD-only and full-day templates do not create empty or overlapping entries', () => {
  const regular = { ...night, times: { start: '07:00', regularEnd: '15:00', standbyEnd: '', end: '' } };
  assert.equal(dutyEntries(regular, '2026-06-16', '07:00', '15:00').length, 1);
  const bdOnly = { ...night, times: { start: '22:00', regularEnd: '22:00', standbyEnd: '06:00', end: '' } };
  assert.equal(dutyEntries(bdOnly, '2026-06-16', '22:00', '06:00')[0].kind, 'standby');
  const fullDay = { ...regular, times: { ...regular.times, regularEnd: '07:00' } };
  assert.equal(durationMinutes(dutyEntries(fullDay, '2026-06-16', '07:00', '07:00')[0]), 1440);
});

test('invalid times, overlong clock chains and missing template selection are rejected', () => {
  assert.throws(() => dutyEntries(night, '2026-06-16', '08:00', '08:00'));
  assert.throws(() => dutyEntries(night, '2026-02-30', '21:45', '08:00'));
  assert.throws(() => validateDutyTemplate({ ...night, times: { ...night.times, standbyEnd: '24:00' } }));
  assert.throws(() =>
    validateDutyTemplate({
      ...night,
      times: { start: '21:45', regularEnd: '02:45', standbyEnd: '01:45', end: '08:00' }
    })
  );
  assert.throws(() => dutyEntriesFromForm(new FormData(), { ...defaultRules, dutyTemplates: [night] }));
});

test('the configured BD compensation reaches entries and routes hours to time credit or payment', () => {
  const profile = {
    ...defaultRules,
    dailyHours: [0, 0, 0, 0, 0, 0, 0],
    rateMode: 'manual' as const,
    individualRate: 50.88
  };
  const fzaEntries = dutyEntries({ ...night, bdTimeOff: true }, '2026-06-16', '21:45', '08:00');
  const paidEntries = dutyEntries({ ...night, bdTimeOff: false }, '2026-06-16', '21:45', '08:00');
  assert.equal(fzaEntries.find(entry => entry.kind === 'standby')?.meta?.bdTimeOff, true);
  assert.equal(paidEntries.find(entry => entry.kind === 'standby')?.meta?.bdTimeOff, false);
  const fza = calculate(fzaEntries, profile, '2026-06', emptySettlement('2026-06'));
  const paid = calculate(paidEntries, profile, '2026-06', emptySettlement('2026-06'));
  assert.ok(Math.abs(fza.standbyCredit - 3.8) < 1e-9);
  assert.equal(fza.standbyPaidHours, 0);
  assert.equal(fza.dutyPay, 0);
  assert.ok(Math.abs(fza.balance - 10.05) < 1e-9);
  assert.equal(paid.standbyCredit, 0);
  assert.ok(Math.abs(paid.standbyPaidHours - 3.8) < 1e-9);
  assert.ok(Math.abs(paid.balance - 6.25) < 1e-9);
  assert.equal(paid.dutyPay, 193.34);
  assert.throws(() => validateDutyTemplate({ ...night, bdTimeOff: 'fza' }));
});
