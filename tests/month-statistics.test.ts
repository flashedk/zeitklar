import assert from 'node:assert/strict';
import test from 'node:test';
import { monthStatistics } from '../src/lib/month-statistics';
import { calculate } from '../src/lib/calculate';
import { auditReport } from '../src/lib/audit';
import { automaticContinuedPay } from '../src/lib/sickness';
import { defaultRules, emptySettlement, type Entry } from '../src/lib/model';
import type { ReportDay, TimeReport } from '../src/lib/report';

const month = '2026-07';
const rules = { ...defaultRules, federalState: 'BY', confirmed: true };
const settlement = emptySettlement(month);
const report = (overrides: Partial<TimeReport> = {}): TimeReport => ({
  period: month,
  printedAt: '',
  filename: '',
  days: [],
  totals: {},
  wageTypes: {},
  issues: [],
  transfers: [],
  warnings: [],
  rawText: '',
  ...overrides
});
const day = (overrides: Partial<ReportDay>): ReportDay => ({
  date: '2026-07-01',
  label: '',
  plannedHours: null,
  actualHours: null,
  overtimeHours: null,
  standbyHours: null,
  standbyWeightedHours: null,
  standbyCount: null,
  nightHours: null,
  saturdayHours: null,
  sundayHours: null,
  holidayHours: null,
  spans: [],
  rawLines: [],
  ...overrides
});
const entry = (overrides: Partial<Entry> = {}): Entry => ({
  date: '2026-07-01',
  kind: 'standby',
  start: '20:00',
  end: '23:00',
  breakMinutes: 0,
  note: '',
  meta: { bdLevel: 'I' },
  ...overrides
});
function stats(source: TimeReport | null, entries: Entry[] = []) {
  return monthStatistics(
    month,
    entries,
    calculate(entries, rules, month, settlement),
    source,
    source ? auditReport(source, rules, settlement) : null,
    automaticContinuedPay(entries, source ? [source] : [], rules, month)
  );
}

test('report statistics use monthly claims including zero and fractional duty counts', () => {
  const source = report({
    totals: { actualHours: 170, contractualTarget: 160, monthlyBalance: 10, bdCount: 3.5, bdHours: 40 },
    wageTypes: { nightTotal: 12, night: 2, sunday: 0, saturday: 3, overtimeBonus: 0, holiday35: 4, holiday135: 2 }
  });
  const result = stats(source, [entry()]);
  assert.equal(result.delta, 10);
  assert.equal(result.standbyCount, 3.5);
  assert.equal(result.standbyHours, 40);
  assert.equal(result.night, 12);
  assert.equal(result.sunday, 0);
  assert.equal(result.saturday, 3);
  assert.equal(result.holiday, 6);
  assert.equal(result.overtime, 0);
  assert.equal(result.oncallCount, null);
});

test('available daily quantities and night wage components provide missing monthly statistics', () => {
  const result = stats(
    report({
      totals: { actualHours: 170, contractualTarget: 160 },
      wageTypes: { night: 4, nightStandby: 6 },
      days: [
        day({ standbyCount: 0.5, standbyHours: 8, sundayHours: 2, saturdayHours: 1, holidayHours: 3 }),
        day({ date: '2026-07-02', standbyCount: 1, standbyHours: 12, sundayHours: 0, holidayHours: 2 })
      ]
    })
  );
  assert.equal(result.delta, 10);
  assert.equal(result.standbyCount, 1.5);
  assert.equal(result.standbyHours, 20);
  assert.equal(result.night, 10);
  assert.equal(result.sunday, 2);
  assert.equal(result.saturday, 1);
  assert.equal(result.holiday, 5);
  assert.equal(result.overtime, null, 'a monthly plus cannot create overtime');
});

test('missing source quantities remain unknown and a blank overtime claim follows the existing zero convention', () => {
  const missing = stats(report());
  for (const key of ['standbyCount', 'standbyHours', 'night', 'saturday', 'sunday', 'holiday', 'overtime'] as const)
    assert.equal(missing[key], null);
  assert.equal(missing.vacationDays, null);
  assert.equal(missing.sickDays, null);
  assert.equal(stats(report({ wageTypes: { overtimeBonus: null } })).overtime, 0);
  const empty = stats(null);
  for (const value of Object.values(empty)) assert.equal(value, null);
});

test('personal service phases count once and monthly hours come from the existing calculation', () => {
  const meta = { dutyDate: '2026-07-01', dutyName: 'Nachtdienst', bdLevel: 'I' as const };
  const entries = [
    entry({ meta }),
    entry({ date: '2026-07-02', start: '00:00', end: '05:00', meta }),
    entry({ date: '2026-07-05', kind: 'oncall', start: '08:00', end: '20:00' })
  ];
  const result = stats(null, entries);
  assert.equal(result.standbyCount, 1);
  assert.equal(result.standbyHours, 8);
  assert.equal(result.oncallCount, 1);
  assert.equal(result.night, 8);
  assert.equal(result.sunday, 0);
  assert.equal(result.holiday, 0);
  assert.equal(result.overtime, null);
});

test('absence statistics count eligible days even if reference amounts for continued pay are missing', () => {
  const entries = [
    entry({ kind: 'vacation', start: '', end: '' }),
    entry({ date: '2026-07-02', kind: 'sick', start: '', end: '' }),
    entry({ date: '2026-07-04', kind: 'vacation', start: '', end: '' })
  ];
  const sickness = automaticContinuedPay(entries, [], rules, month);
  assert.equal(sickness?.amount, null);
  const result = stats(null, entries);
  assert.equal(result.vacationDays, 1);
  assert.equal(result.sickDays, 1);
});
