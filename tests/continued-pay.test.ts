import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyContinuedPayAction,
  calculateContinuedPay,
  continuedPayMonths,
  createSickPeriodId,
  emptyContinuedPay,
  mergeContinuedPay,
  referenceMonths,
  suggestDays,
  suggestReference,
  validateContinuedPay,
  validatePeriod,
  validateReference,
  type ContinuedPay,
  type PayReference,
  type SickPeriod
} from '../src/lib/continued-pay';
import { defaultRules, type Entry } from '../src/lib/model';
import { getReviewMonths } from '../src/lib/review';
import type { TimeReport } from '../src/lib/report';

const period = (extra: Partial<SickPeriod> = {}): SickPeriod => ({
  id: 'october',
  start: '2026-10-05',
  end: '2026-10-09',
  days: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'],
  workDaysPerWeek: 5,
  employmentStart: '',
  workTimeChange: '',
  divisorOverride: null,
  individualAmount: null,
  individualDays: null,
  adjustments: {},
  confirmed: true,
  note: '',
  ...extra
});
const reference = (month: string, amount: number): PayReference => ({
  month,
  amounts: { timeBonus: amount, standby: 0, oncall: 0, plannedOvertime: 0, other: 0 },
  excludedAmount: 0,
  excludedDays: 0,
  source: 'Lohnabrechnung',
  sourceKey: '',
  confirmed: true
});
const workspace = (p = period()): ContinuedPay => ({
  ...emptyContinuedPay(),
  periods: [p],
  references: [reference('2026-07', 400), reference('2026-08', 400), reference('2026-09', 500)]
});
const form = (operation: string, value?: unknown) => {
  const f = new FormData();
  f.set('operation', operation);
  if (value !== undefined) f.set('value', JSON.stringify(value));
  return f;
};

test('record creation works on HTTP with getRandomValues but without randomUUID', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  const browserCrypto = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: browserCrypto });
  try {
    assert.equal(typeof globalThis.crypto.randomUUID, 'undefined');
    const ids = Array.from({ length: 100 }, () => createSickPeriodId());
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.equal(validatePeriod(period({ id })).id, id);
    const saved = applyContinuedPayAction(
      emptyContinuedPay(),
      form('period', period({ id: ids[0] })),
      [],
      defaultRules
    );
    assert.equal(saved.periods[0].id, ids[0]);
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor);
  }
});
test('record creation still works when browser crypto is entirely unavailable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try {
    const ids = Array.from({ length: 100 }, () => createSickPeriodId());
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.equal(validatePeriod(period({ id })).id, id);
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor);
  }
});

test('three complete months yield 20 EUR per day and 100 EUR for five lost workdays', () => {
  const line = calculateContinuedPay(workspace(), '2026-10')[0];
  assert.equal(line.sum, 1300);
  assert.equal(line.divisor, 65);
  assert.equal(line.dailyRate, 20);
  assert.equal(line.amount, 100);
  assert.deepEqual(line.months, ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(line.warnings, []);
});
test('one continuing illness keeps its reference months and allocates payment to each month once', () => {
  const p = period({ start: '2026-10-30', end: '2026-11-03', days: ['2026-10-30', '2026-11-02', '2026-11-03'] });
  const s = workspace(p),
    oct = calculateContinuedPay(s, '2026-10')[0],
    nov = calculateContinuedPay(s, '2026-11')[0];
  assert.deepEqual(nov.months, oct.months);
  assert.equal(oct.amount, 20);
  assert.equal(nov.amount, 40);
  assert.deepEqual(continuedPayMonths(s), ['2026-10', '2026-11']);
});
test('null and unconfirmed references remain incomplete; confirmed zero is a valid basis', () => {
  const s = workspace();
  s.references.pop();
  assert.equal(calculateContinuedPay(s, '2026-10')[0].amount, null);
  s.references.push(reference('2026-09', 0));
  s.references.forEach(r => (r.amounts.timeBonus = 0));
  assert.equal(calculateContinuedPay(s, '2026-10')[0].amount, 0);
  s.references[0].confirmed = false;
  assert.equal(calculateContinuedPay(s, '2026-10')[0].amount, null);
  assert.throws(
    () =>
      validateReference({ ...reference('2026-09', 0), amounts: { ...reference('2026-09', 0).amounts, standby: null } }),
    /alle Referenzpositionen/
  );
});
test('earlier continuation amounts are excluded while the requested divisor stays fixed at 65', () => {
  const s = workspace();
  s.references[0].excludedAmount = 100;
  s.references[0].excludedDays = 5;
  const line = calculateContinuedPay(s, '2026-10')[0];
  assert.equal(line.sum, 1200);
  assert.equal(line.divisor, 65);
  assert.equal(line.dailyRate, 18.46);
  assert.equal(line.amount, 92.3);
});
test('the fixed payroll divisor applies to saved periods regardless of weekly distribution', () => {
  const p = period({ workDaysPerWeek: 4, end: '2026-10-11', days: ['2026-10-11'] }),
    s = workspace(p);
  assert.equal(calculateContinuedPay(s, '2026-10')[0].divisor, 65);
  assert.equal(calculateContinuedPay(s, '2026-10')[0].amount, 20);
});
test('employment and individual working-time changes shorten the reference period; an explicit divisor is required', () => {
  const p = period({ employmentStart: '2026-07-15', workTimeChange: '2026-09-01' });
  assert.deepEqual(referenceMonths(p), ['2026-09']);
  assert.equal(calculateContinuedPay(workspace(p), '2026-10')[0].amount, null);
  p.divisorOverride = 25;
  assert.equal(calculateContinuedPay(workspace(p), '2026-10')[0].amount, 100);
});
test('without a full month, individual entitlements are divided by actual days worked', () => {
  const p = period({ employmentStart: '2026-09-15' }); // September was not a full employment month.
  assert.deepEqual(referenceMonths(p), []);
  assert.equal(calculateContinuedPay(workspace(p), '2026-10')[0].amount, null);
  p.individualAmount = 200;
  p.individualDays = 10;
  assert.equal(calculateContinuedPay(workspace(p), '2026-10')[0].amount, 100);
});
test('general pay adjustments apply 90 percent of the rate, scoped to the illness', () => {
  const p = period({ adjustments: { '2026-07': 10 } }),
    line = calculateContinuedPay(workspace(p), '2026-10')[0];
  assert.equal(line.sum, 1336);
  assert.equal(line.dailyRate, 20.55);
  assert.equal(line.amount, 102.75);
  assert.equal(calculateContinuedPay(workspace(), '2026-10')[0].sum, 1300);
});
test('dates are deduplicated, conflicts rejected, and six-week eligibility is not inferred', () => {
  const p = validatePeriod(period({ days: ['2026-10-05', '2026-10-05'] }));
  assert.equal(p.days.length, 1);
  assert.throws(() => validatePeriod(period({ days: ['2026-11-01'] })), /Ungültiger/);
  assert.throws(
    () => validateContinuedPay({ ...workspace(), periods: [period(), period({ id: 'overlap' })] }),
    /überschneiden/
  );
  const late = period({ end: '2026-11-20', days: ['2026-11-20'] });
  assert.equal(calculateContinuedPay(workspace(late), '2026-11')[0].amount, null);
  assert.equal(calculateContinuedPay(workspace(period({ confirmed: false })), '2026-10')[0].amount, null);
});
test('payment acknowledgement is tied to the complete calculation and contributes to open months without a report', () => {
  let s = workspace();
  const line = calculateContinuedPay(s, '2026-10')[0],
    f = form('acknowledge');
  f.set('month', '2026-10');
  f.set('key', line.key);
  f.set('acknowledged', 'true');
  assert.deepEqual(getReviewMonths({ reports: [], rules: defaultRules, entries: [], continuedPay: s }), ['2026-10']);
  s = applyContinuedPayAction(s, f, [], defaultRules);
  assert.ok(calculateContinuedPay(s, '2026-10')[0].acknowledgedAt);
  assert.deepEqual(getReviewMonths({ reports: [], rules: defaultRules, entries: [], continuedPay: s }), []);
  s.references[0].amounts.timeBonus = 500;
  assert.equal(calculateContinuedPay(s, '2026-10')[0].acknowledgedAt, null);
  assert.throws(() => applyContinuedPayAction(s, f, [], defaultRules), /veraltet/);
});
test('report suggestions omit fixed allowances and overtime and never claim completeness', () => {
  const report: TimeReport = {
    period: '2026-07',
    printedAt: '2026-08-01',
    filename: 'juli.txt',
    days: [],
    totals: {},
    wageTypes: { night: 10, overtimeBonus: 20, shiftAllowance: 40 },
    transfers: [],
    issues: [],
    warnings: [],
    rawText: ''
  };
  const ref = suggestReference('2026-07', [report], defaultRules);
  assert.equal(ref.amounts.timeBonus, 73.1);
  assert.equal(ref.amounts.plannedOvertime, null);
  assert.equal(ref.amounts.standby, null);
  assert.equal(ref.confirmed, false);
  const s = workspace();
  s.references[0] = {
    ...ref,
    confirmed: true,
    amounts: { timeBonus: 73.1, standby: 0, oncall: 0, plannedOvertime: 0, other: 0 }
  };
  assert.notEqual(calculateContinuedPay(s, '2026-10', [report], defaultRules)[0].amount, null);
  assert.equal(
    calculateContinuedPay(s, '2026-10', [{ ...report, wageTypes: { night: 20 } }], defaultRules)[0].amount,
    null
  );
});
test('backup merge rejects conflicting bases and overlapping periods; legacy data receives empty state', () => {
  assert.deepEqual(validateContinuedPay(undefined), emptyContinuedPay());
  assert.deepEqual(mergeContinuedPay(workspace(), workspace()), workspace());
  const changed = workspace();
  changed.references[0].amounts.timeBonus = 2;
  assert.throws(() => mergeContinuedPay(workspace(), changed), /abweichende Referenz/);
  const overlapping = emptyContinuedPay();
  overlapping.periods = [period({ id: 'other' })];
  assert.throws(() => mergeContinuedPay(workspace(), overlapping), /überschneiden/);
});
test('sick diary entries only supply date suggestions, deduplicated and within the selected period', () => {
  const entry: Entry = { date: '2026-10-05', start: '', end: '', breakMinutes: 0, kind: 'sick', note: '' };
  assert.deepEqual(
    suggestDays('2026-10-05', '2026-10-09', [
      entry,
      entry,
      { ...entry, date: '2026-10-10' },
      { ...entry, date: '2026-10-06', kind: 'vacation' }
    ]),
    ['2026-10-05']
  );
});
