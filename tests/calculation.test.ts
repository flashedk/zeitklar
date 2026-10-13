import assert from 'node:assert/strict';
import test from 'node:test';
import { calculate, hasClockChange, tariffRate } from '../src/lib/calculate';
import { defaultRules, emptySettlement, validateEntry, type Entry, type Rules } from '../src/lib/model';

const profile = (overrides: Partial<Rules> = {}): Rules => ({
  ...defaultRules,
  dailyHours: [...defaultRules.dailyHours],
  holidays: [],
  confirmed: true,
  individualRate: 50.88,
  overtimeBaseRate: 50.88,
  group: '2',
  rateMode: 'manual',
  ...overrides
});
const duty = (overrides: Partial<Entry> = {}): Entry => ({
  date: '2026-07-01',
  start: '16:00',
  end: '08:00',
  breakMinutes: 0,
  kind: 'standby',
  note: '',
  meta: { bdLevel: 'I' },
  ...overrides
});
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.000001, `${a} ≠ ${b}`);

test('provided BD example: 16 h level I + 10 h night = EUR 590.25', () => {
  const result = calculate([duty()], profile(), '2026-07', emptySettlement('2026-07'));
  close(result.actual, 16);
  close(result.night, 10);
  close(result.rows[0].bdWeighted, 9.6);
  assert.equal(result.dutyPay, 488.45);
  assert.equal(result.expectedBonus, 101.8);
  assert.equal(result.expectedPay, 590.25);
  const fifth = calculate(
    [duty({ meta: { bdLevel: 'I', bdExtraPoints: 10 } })],
    profile(),
    '2026-07',
    emptySettlement('2026-07')
  );
  assert.equal(fifth.expectedPay, 671.66);
});

test('BD holiday adds 25 percentage points; only night is a time bonus', () => {
  const result = calculate(
    [duty({ date: '2026-07-05', start: '00:00', end: '08:00', meta: { bdLevel: 'II' } })],
    profile({ holidays: ['2026-07-05'] }),
    '2026-07',
    emptySettlement('2026-07')
  );
  close(result.rows[0].bdWeighted, 9.6);
  assert.equal(result.dutyPay, 488.45);
  assert.equal(result.expectedBonus, 61.08);
  close(result.sunday, 0);
  const fza = calculate(
    [duty({ meta: { bdLevel: 'I', bdTimeOff: true } })],
    profile(),
    '2026-07',
    emptySettlement('2026-07')
  );
  assert.equal(fza.dutyPay, 0);
  assert.equal(fza.expectedBonus, 101.8);
});

test('highest holiday/Sunday bonus stacks with night and confirmed overtime', () => {
  const settlement = { ...emptySettlement('2026-07'), overtimeHours: 2 };
  const result = calculate(
    [duty({ date: '2026-07-05', kind: 'work', start: '20:00', end: '22:00', meta: { holidayCompensated: false } })],
    profile({ holidays: ['2026-07-05'] }),
    '2026-07',
    settlement
  );
  assert.equal(result.expectedBonus, 173); // 2 × (68.69 + 10.18 + 7.63)
  close(result.night, 2);
  close(result.sunday, 2);
  close(result.holiday, 2);
});

test('month plus does not create tariff overtime; explicit settlement does', () => {
  const entry = duty({ kind: 'work', start: '08:00', end: '18:00', meta: {} });
  const s = { ...emptySettlement('2026-07'), targetHours: 8 };
  const result = calculate([entry], profile(), '2026-07', s);
  close(result.delta, 2);
  assert.equal(result.overtimeBonus, 0);
  const explicit = calculate([entry], profile(), '2026-07', { ...s, overtimeHours: 2, overtimePaidHours: 2 });
  assert.equal(explicit.overtimeBonus, 15.26);
  assert.equal(explicit.dutyPay, 101.76);
});

test('pause at a known time removes the actual bonus minutes', () => {
  const entry = duty({ kind: 'work', start: '19:00', end: '22:00', breakMinutes: 60, meta: { pauseStart: '20:00' } });
  const result = calculate([entry], profile(), '2026-07', emptySettlement('2026-07'));
  close(result.actual, 2);
  close(result.night, 1);
  assert.equal(result.expectedBonus, 10.18);
  assert.ok(!result.warnings.some(s => s.includes('proportional')));
  const approximate = calculate([{ ...entry, meta: {} }], profile(), '2026-07', emptySettlement('2026-07'));
  close(approximate.night, 4 / 3);
  assert.ok(approximate.warnings.some(s => s.includes('proportional')));
});

test('overnight shift is split across service months', () => {
  const entry = duty({ date: '2026-07-31', kind: 'work', start: '22:00', end: '02:00', meta: {} });
  const july = calculate([entry], profile(), '2026-07', emptySettlement('2026-07'));
  const august = calculate([entry], profile(), '2026-08', emptySettlement('2026-08'));
  close(july.actual, 2);
  close(august.actual, 2);
  close(july.night, 2);
  close(august.night, 2);
  assert.equal(july.expectedBonus, 20.36);
  assert.equal(august.expectedBonus, 20.36);
});

test('24 h requires explicit flag and preserves ten night hours', () => {
  assert.throws(() => validateEntry(duty({ start: '08:00', end: '08:00', meta: {} })));
  const entry = validateEntry(duty({ kind: 'work', start: '08:00', end: '08:00', meta: { fullDay: true } }));
  const result = calculate([entry], profile(), '2026-07', emptySettlement('2026-07'));
  close(result.actual, 24);
  close(result.night, 10);
});

test('oncall lump sum depends on starting day; callout rounds each deployment', () => {
  const oncall = duty({ date: '2026-07-04', start: '18:00', end: '06:00', kind: 'oncall', meta: {} });
  const callout = duty({ date: '2026-07-04', start: '22:00', end: '23:10', kind: 'callout', meta: {} });
  const result = calculate([oncall, callout], profile(), '2026-07', emptySettlement('2026-07'));
  close(result.actual, 7 / 6);
  assert.equal(result.rows[0].dutyPay, 203.52);
  assert.equal(result.rows[0].bonus, 0);
  assert.equal(result.rows[1].dutyPay, 117.02);
  assert.equal(result.rows[1].bonus, 11.88);
  const short = calculate(
    [duty({ kind: 'oncall', start: '12:00', end: '13:10', meta: {} })],
    profile(),
    '2026-07',
    emptySettlement('2026-07')
  );
  assert.equal(short.dutyPay, 12.72);
  close(short.actual, 0);
});

test('tariff table is selected by service month, not print or payment date', () => {
  assert.equal(tariffRate('2', '2026-07'), 50.88);
  assert.equal(tariffRate('2', '2027-08'), 50.88);
  assert.equal(tariffRate('2', '2027-09'), 52.13);
});

test('overlapping personal duties are flagged before interpreting the calculated sum', () => {
  const first = duty({ kind: 'work', start: '08:00', end: '16:00', meta: {} });
  const second = duty({ kind: 'work', start: '15:00', end: '18:00', meta: {} });
  const result = calculate([first, second], profile(), '2026-07', emptySettlement('2026-07'));
  assert.ok(result.warnings.some(s => s.includes('Doppelzählung')));
});

test('DST shifts keep clock arithmetic but visibly require actual time stamps', () => {
  for (const date of ['2026-03-29', '2026-10-25']) {
    const entry = duty({ date, kind: 'work', start: '01:00', end: '04:00', meta: {} });
    const month = date.slice(0, 7);
    const result = calculate([entry], profile(), month, emptySettlement(month));
    close(result.actual, 3);
    assert.ok(result.warnings.some(s => s.includes('Zeitumstellung')));
    assert.ok(hasClockChange(entry));
  }
  assert.ok(hasClockChange(duty({ date: '2026-10-24', start: '22:00', end: '04:00' })));
  assert.equal(hasClockChange(duty({ date: '2026-10-25', start: '04:00', end: '08:00' })), false);
});

test('weekly change adjusts historical target and absence credit; disabled keeps existing targets', () => {
  const rules = profile({ workTimeChangeEnabled: true });
  const sick = { date: '2025-11-03', start: '', end: '', kind: 'sick' as const, breakMinutes: 0, note: '', meta: {} };
  const november = calculate([sick], rules, '2025-11', emptySettlement('2025-11'));
  close(november.target, 168);
  close(november.credited, 8.4);
  const january = calculate([{ ...sick, date: '2026-01-02' }], rules, '2026-01', emptySettlement('2026-01'));
  close(january.target, 176);
  close(january.credited, 8);
  close(calculate([], { ...rules, workTimeChangeEnabled: false }, '2025-11', emptySettlement('2025-11')).target, 160);
  close(calculate([], rules, '2025-11', { ...emptySettlement('2025-11'), targetHours: 170 }).target, 170);
});

test('midmonth weekly change applies target and bonus rates to the actual service date', () => {
  const rules = profile({ workTimeChangeEnabled: true, workTimeChangeDate: '2026-07-15' });
  const entries = ['2026-07-14', '2026-07-15'].map(date =>
    duty({ date, kind: 'work', start: '20:00', end: '22:00', meta: {} })
  );
  const result = calculate(entries, rules, '2026-07', emptySettlement('2026-07'));
  close(result.target, 188);
  assert.equal(result.rows[0].bonus, 19.38);
  assert.equal(result.rows[1].bonus, 20.36);
  assert.equal(result.expectedBonus, 39.74);
});

test('verified historical night and Saturday time bands change in April 2024', () => {
  const beforeEntry = duty({ date: '2024-03-02', kind: 'work', start: '20:00', end: '22:00', meta: {} });
  const afterEntry = { ...beforeEntry, date: '2024-04-06' };
  const before = calculate([beforeEntry], profile(), '2024-03', emptySettlement('2024-03'));
  const after = calculate([afterEntry], profile(), '2024-04', emptySettlement('2024-04'));
  close(before.night, 1);
  close(before.saturday, 1);
  close(after.night, 2);
  close(after.saturday, 0);
});

test('supplement breakdown respects holiday/weekend competition, BD rules and special days', () => {
  const entries = [
    duty({ date: '2026-07-05', kind: 'work', start: '20:00', end: '22:00', meta: { holidayCompensated: false } }),
    duty({ date: '2026-07-12', kind: 'work', start: '20:00', end: '22:00', meta: {} }),
    duty({ date: '2026-07-11', kind: 'work', start: '18:00', end: '22:00', meta: {} }),
    duty({ date: '2026-07-05', start: '00:00', end: '08:00', meta: { bdLevel: 'II' } })
  ];
  const result = calculate(entries, profile({ holidays: ['2026-07-05'] }), '2026-07', emptySettlement('2026-07'));
  assert.deepEqual(result.rows[0].timeSupplements, { night: 20.36, weekend: 0, holiday: 137.38 });
  assert.deepEqual(result.rows[1].timeSupplements, { night: 20.36, weekend: 25.44, holiday: 0 });
  assert.deepEqual(result.rows[2].timeSupplements, { night: 20.36, weekend: 20.36, holiday: 0 });
  assert.deepEqual(result.rows[3].timeSupplements, { night: 61.08, weekend: 0, holiday: 0 });
  const special = calculate(
    [duty({ date: '2026-12-24', kind: 'work', start: '06:00', end: '08:00', meta: {} })],
    profile(),
    '2026-12',
    emptySettlement('2026-12')
  );
  assert.deepEqual(special.rows[0].timeSupplements, { night: 0, weekend: 0, holiday: 35.62 });
});

test('custom additive and highest modes split the payable amounts and resolve ties consistently', () => {
  const rules = profile({ tariff: false, hourlyRate: 10, holidays: ['2026-07-05'] });
  const entry = duty({ date: '2026-07-05', kind: 'work', start: '20:00', end: '22:00', meta: {} });
  const additive = calculate([entry], { ...rules, stacking: 'add' }, '2026-07', emptySettlement('2026-07'));
  assert.equal(additive.expectedBonus, 16);
  assert.deepEqual(additive.rows[0].timeSupplements, { night: 4, weekend: 5, holiday: 7 });
  const highest = calculate([entry], rules, '2026-07', emptySettlement('2026-07'));
  assert.equal(highest.expectedBonus, 11);
  assert.deepEqual(highest.rows[0].timeSupplements, { night: 4, weekend: 0, holiday: 7 });
  const tied = calculate([entry], { ...rules, holidayPercent: 25 }, '2026-07', emptySettlement('2026-07'));
  assert.deepEqual(tied.rows[0].timeSupplements, { night: 4, weekend: 0, holiday: 5 });
});

test('breakdown uses actual pause minutes, proportional pauses and monthly boundaries', () => {
  const rules = profile({ tariff: false, hourlyRate: 10 });
  const entry = duty({
    date: '2026-07-12',
    kind: 'work',
    start: '19:00',
    end: '22:00',
    breakMinutes: 60,
    meta: { pauseStart: '20:00' }
  });
  const exact = calculate([entry], rules, '2026-07', emptySettlement('2026-07'));
  assert.deepEqual(exact.rows[0].timeSupplements, { night: 2, weekend: 5, holiday: 0 });
  const approximate = calculate([{ ...entry, meta: {} }], rules, '2026-07', emptySettlement('2026-07'));
  assert.deepEqual(approximate.rows[0].timeSupplements, { night: 2.67, weekend: 5, holiday: 0 });
  const overnight = duty({ date: '2026-05-31', kind: 'work', start: '22:00', end: '02:00', meta: {} });
  assert.deepEqual(calculate([overnight], rules, '2026-05', emptySettlement('2026-05')).rows[0].timeSupplements, {
    night: 4,
    weekend: 5,
    holiday: 0
  });
  assert.deepEqual(calculate([overnight], rules, '2026-06', emptySettlement('2026-06')).rows[0].timeSupplements, {
    night: 4,
    weekend: 0,
    holiday: 0
  });
});

test('fractional-cent breakdowns always reconcile exactly with the existing row and month totals', () => {
  for (const stacking of ['add', 'highest'] as const)
    for (const rate of [0.1, 0.13, 10.07, 50.88]) {
      const rules = profile({ tariff: false, hourlyRate: rate, stacking, holidays: ['2026-07-05'] });
      const entries = Array.from({ length: 40 }, (_, i) =>
        duty({
          date: i % 2 ? '2026-07-05' : '2026-07-12',
          kind: 'work',
          start: '20:00',
          end: `20:${String(i + 1).padStart(2, '0')}`,
          breakMinutes: i % 5,
          meta: {}
        })
      );
      const result = calculate(entries, rules, '2026-07', emptySettlement('2026-07'));
      for (const row of result.rows) {
        assert.equal(
          Object.values(row.timeSupplements).reduce((sum, amount) => sum + Math.round(amount * 100), 0),
          Math.round(row.bonus * 100)
        );
        assert.ok(Object.values(row.timeSupplements).every(amount => amount >= 0));
      }
      assert.equal(
        result.rows.reduce(
          (sum, row) => sum + Object.values(row.timeSupplements).reduce((n, amount) => n + Math.round(amount * 100), 0),
          0
        ),
        Math.round(result.expectedBonus * 100)
      );
    }
});
