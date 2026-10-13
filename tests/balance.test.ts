import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateOpeningRules, resolveMonthSettlement } from '../src/lib/balance';
import { defaultRules, emptySettlement, patchMonthSettings, validateRules, type Entry } from '../src/lib/model';
import { getEmployerHours } from '../src/lib/audit';
import { calculate } from '../src/lib/calculate';
import type { TimeReport } from '../src/lib/report';

const rules = { ...defaultRules, openingMonth: '2026-07', openingHoursEntered: true, openingHours: 10 };
const report = (period: string, closingBalance: number | null = null): TimeReport => ({
  period,
  printedAt: '',
  filename: '',
  days: [],
  totals: { actualHours: 165, contractualTarget: 160, plannedTarget: 160, openingBalance: null, closingBalance },
  wageTypes: {},
  issues: [],
  transfers: [],
  warnings: [],
  rawText: ''
});

test('global opening applies once and calculated balances carry through consecutive reports', () => {
  const reports = [report('2026-07'), report('2026-08'), report('2026-09')];
  const first = resolveMonthSettlement(rules, '2026-07', [], reports);
  assert.equal(first.openingHours, 10);
  assert.equal(first.openingHoursOrigin, 'initial');
  const third = resolveMonthSettlement(rules, '2026-09', [], reports);
  assert.equal(third.openingHours, 20);
  assert.equal(third.openingHoursOrigin, 'previous');
  assert.equal(getEmployerHours(reports[2], rules, third).computedClosingBalance, 25);
});

test('source closing and current source opening have priority and remain untouched', () => {
  const previous = report('2026-07', 27),
    current = report('2026-08');
  current.totals.openingBalance = 99;
  const before = structuredClone([previous, current]);
  const settlement = resolveMonthSettlement(rules, '2026-08', [], [previous, current]);
  assert.equal(settlement.openingHours, 27);
  assert.equal(getEmployerHours(current, rules, settlement).openingBalance, 99);
  assert.deepEqual([previous, current], before);
});

test('missing report month produces explicit gap without repeating initial balance', () => {
  const value = resolveMonthSettlement(rules, '2026-09', [], [report('2026-07'), report('2026-09')]);
  assert.equal(value.openingHours, 0);
  assert.equal(value.openingHoursEntered, false);
  assert.match(value.openingHoursGap!, /2026-08/);
});

test('legacy explicit zero migrates, empty settlement does not, configured global zero wins', () => {
  const empty = emptySettlement('2026-06');
  const zero = { ...emptySettlement('2026-07'), openingHoursEntered: true };
  assert.equal(migrateOpeningRules(defaultRules, [empty]).openingHoursEntered, false);
  assert.equal(migrateOpeningRules(defaultRules, [zero, empty]).openingMonth, '2026-07');
  assert.deepEqual(migrateOpeningRules({ ...rules, openingHours: 0 }, [{ ...zero, openingHours: 55 }]), {
    ...rules,
    openingHours: 0
  });
});

test('monthly patches preserve stored legacy values while effective calculations ignore them', () => {
  const stored = {
    ...emptySettlement('2026-07'),
    recordedHours: 12,
    paidBonus: 123,
    targetHours: 1,
    extraPay: 42,
    note: 'alt'
  };
  const form = new FormData();
  form.set('month', stored.month);
  form.set('adjustmentHours', '-2,5');
  const patched = patchMonthSettings(form, stored);
  assert.equal(patched.note, 'alt');
  assert.equal(patched.recordedHours, 12);
  assert.equal(patched.paidBonus, 123);
  assert.equal(patched.adjustmentHours, -2.5);
  const effective = resolveMonthSettlement(rules, stored.month, [patched], []);
  assert.equal(effective.recordedHours, null);
  assert.equal(effective.targetHours, null);
  assert.equal(effective.extraPay, 0);
  assert.equal(stored.adjustmentHours, 0);
  form.set('adjustmentHours', 'Infinity');
  assert.throws(() => patchMonthSettings(form, stored));
  form.set('adjustmentHours', '');
  assert.throws(() => patchMonthSettings(form, stored));
});

test('global opening month and entry flag are validated', () => {
  assert.throws(() => validateRules({ ...rules, openingMonth: '2026-13' }));
  assert.throws(() => validateRules({ ...rules, openingMonth: '' }));
  assert.throws(() => validateRules({ ...rules, openingHours: Infinity }));
});

const work = (date: string, end = '16:00'): Entry => ({
  date,
  start: '08:00',
  end,
  breakMinutes: 0,
  kind: 'work',
  note: '',
  meta: {}
});
const weekdays = (month: string) =>
  Array.from(
    { length: new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate() },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`
  ).filter(date => ![0, 6].includes(new Date(date).getUTCDay()));
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('September carries August own-time closing including correction after the July employer balance', () => {
  const profile = { ...defaultRules, confirmed: true, federalState: 'BY' };
  const entries = weekdays('2026-08').map(date => work(date, '16:15'));
  entries.push(
    ...weekdays('2026-09')
      .slice(0, 20)
      .map((date, i) => work(date, i === 19 ? '12:15' : '16:00'))
  );
  for (const day of ['06', '13', '20'])
    entries.push({
      ...work(`2026-09-${day}`, '04:00'),
      start: '00:00',
      kind: 'standby',
      meta: { bdLevel: 'II', bdTimeOff: true }
    });
  const reports = [report('2026-07', 53.65)];
  const settlements = [{ ...emptySettlement('2026-08'), adjustmentHours: 2 }];
  const before = structuredClone({ entries, reports, settlements });
  const august = resolveMonthSettlement(profile, '2026-08', settlements, reports, entries);
  const augustBalance = calculate(entries, profile, '2026-08', august).balance;
  close(augustBalance, 60.9);
  const september = resolveMonthSettlement(profile, '2026-09', settlements, reports, entries);
  assert.equal(september.openingHours, 60.9);
  assert.equal(september.openingHoursOrigin, 'personal');
  assert.equal(september.openingHoursGap, undefined);
  const result = calculate(entries, profile, '2026-09', september);
  close(result.regular, 156.25);
  close(result.standbyCredit, 11.4);
  close(result.delta, -8.35);
  close(result.balance, 52.55);
  assert.deepEqual({ entries, reports, settlements }, before);
});

test('consecutive own months use the initial anchor once and each month correction once', () => {
  const profile = { ...rules, tariff: false, dailyHours: [0, 0, 0, 0, 0, 0, 0] };
  const entries = ['2026-07-01', '2026-08-03', '2026-09-01'].map(date => work(date));
  const settlements = [
    { ...emptySettlement('2026-07'), adjustmentHours: 2 },
    { ...emptySettlement('2026-08'), adjustmentHours: -3 }
  ];
  const september = resolveMonthSettlement(profile, '2026-09', settlements, [], entries);
  assert.equal(september.openingHours, 25); // July 10 + 8 + 2 = 20; August 20 + 8 - 3 = 25.
  close(calculate(entries, profile, '2026-09', september).balance, 33);
});

test('employer closing zero or negative beats provisional own calculations and clears earlier gaps', () => {
  for (const closing of [0, -12.34]) {
    const reports = [report('2026-08', closing)];
    const entries = [work('2026-08-03')];
    const value = resolveMonthSettlement(defaultRules, '2026-09', [], reports, entries);
    assert.equal(value.openingHours, closing);
    assert.equal(value.openingHoursOrigin, 'previous');
    assert.equal(value.openingHoursGap, undefined);
  }
});

test('an available prior report without closing is still calculated from its own opening and hours', () => {
  const prior = report('2026-08');
  prior.totals.openingBalance = 35;
  const value = resolveMonthSettlement(defaultRules, '2026-09', [], [prior], [work('2026-08-03')]);
  assert.equal(value.openingHours, 40);
  assert.equal(value.openingHoursOrigin, 'previous');
  assert.equal(value.openingHoursGap, undefined);
});

test('own-time carry crosses the year and includes an overnight entry in both affected months', () => {
  const profile = {
    ...rules,
    tariff: false,
    dailyHours: [0, 0, 0, 0, 0, 0, 0],
    openingMonth: '2025-12',
    openingHours: -7
  };
  const entries = [{ ...work('2025-12-31', '02:00'), start: '22:00' }];
  const january = resolveMonthSettlement(profile, '2026-01', [], [], entries);
  assert.equal(january.openingHours, -5);
  close(calculate(entries, profile, '2026-01', january).balance, -3);
  const february = resolveMonthSettlement(profile, '2026-02', [], [], entries);
  assert.equal(february.openingHours, -3);
});

test('ending exactly at midnight does not create a phantom following month and gaps stay visible', () => {
  const profile = { ...rules, tariff: false, dailyHours: [0, 0, 0, 0, 0, 0, 0], openingMonth: '2026-07' };
  const entries = [{ ...work('2026-07-31', '00:00'), start: '22:00' }];
  const september = resolveMonthSettlement(profile, '2026-09', [], [], entries);
  assert.equal(september.openingHours, 0);
  assert.match(september.openingHoursGap!, /2026-08/);
  const result = calculate(entries, profile, '2026-09', september);
  assert.ok(result.warnings.includes(september.openingHoursGap!));
});

test('a missing earlier month remains identified through a chain of own-time balances', () => {
  const profile = { ...defaultRules, tariff: false, dailyHours: [0, 0, 0, 0, 0, 0, 0] };
  const entries = [work('2026-08-03')];
  const september = resolveMonthSettlement(profile, '2026-09', [], [], entries);
  assert.equal(september.openingHours, 8);
  assert.equal(september.openingHoursOrigin, 'personal');
  assert.match(september.openingHoursGap!, /2026-07/);
  const current = report('2026-09');
  const summary = getEmployerHours(current, profile, september);
  assert.ok(summary.assumptions.some(note => note.includes('eigenen Zeitaufzeichnungen des Vormonats')));
});
