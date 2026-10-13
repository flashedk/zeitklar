import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { yearOverview } from '../src/lib/year-overview';
import { defaultRules, emptySettlement, type Entry } from '../src/lib/model';
import { parseText } from '../src/lib/importer';
import { auditReport } from '../src/lib/audit';
import { calculate } from '../src/lib/calculate';
import { automaticContinuedPay, compensationTotal } from '../src/lib/sickness';
import type { TimeReport } from '../src/lib/report';
import type { YearOverviewInput } from '../src/lib/year-overview';

const rules = {
  ...defaultRules,
  federalState: 'BY',
  confirmed: true,
  group: '2' as const,
  rateMode: 'manual' as const,
  individualRate: 50.88
};
const page = (overrides: Partial<YearOverviewInput> = {}): YearOverviewInput => ({
  entries: [],
  reports: [],
  rules,
  settlement: emptySettlement('2026-07'),
  month: '2026-07',
  months: [],
  report: null,
  ...overrides
});
const report = (period: string, overrides: Partial<TimeReport> = {}): TimeReport => ({
  period,
  printedAt: '',
  filename: '',
  days: [],
  totals: { actualHours: 170, contractualTarget: 160, plannedTarget: 160, closingBalance: 10, bdCount: 3.5 },
  wageTypes: { night: 0, overtimeBonus: 0 },
  transfers: [],
  issues: [],
  warnings: [],
  rawText: '',
  ...overrides
});
const entry = (overrides: Partial<Entry> = {}): Entry => ({
  date: '2026-07-01',
  start: '20:00',
  end: '23:00',
  breakMinutes: 0,
  kind: 'standby',
  note: '',
  meta: { bdLevel: 'I' },
  ...overrides
});

test('missing months remain null, while observed zero pay and overtime enter averages', () => {
  const annual = yearOverview(
    page({ reports: [report('2026-01'), report('2026-03', { wageTypes: { night: 10, overtimeBonus: 4 } })] }),
    2026
  );
  assert.equal(annual.monthCount, 2);
  assert.equal(annual.payMonthCount, 2);
  assert.equal(annual.months[0].pay, 0);
  assert.equal(annual.months[0].overtime, 0);
  assert.equal(annual.months[1].pay, null);
  assert.equal(annual.months[1].balance, null);
  assert.equal(annual.averageOvertime, 2);
  assert.equal(annual.averageStandby, 3.5);
  assert.equal(annual.averagePay, Math.round((annual.totalPay! / 2) * 100) / 100);
  assert.equal(annual.months[0].oncall, null);
});

test('annual report pay matches monthly calculation and composition includes continued pay', () => {
  const reports = ['dpl-july-2026.txt', 'dpl-sick-december-2025.txt'].map(
    name => parseText(readFileSync(`tests/fixtures/${name}`, 'utf8'), name).report!
  );
  for (const r of reports) {
    const data = page({ reports, settlement: emptySettlement(r.period), month: r.period });
    const annual = yearOverview(data, Number(r.period.slice(0, 4)));
    const row = annual.months[Number(r.period.slice(5)) - 1];
    assert.equal(
      row.pay,
      compensationTotal(
        auditReport(r, rules, data.settlement, reports),
        automaticContinuedPay([], reports, rules, r.period)
      )
    );
    if (row.pay !== null)
      assert.ok(Math.abs(Object.values(row.components).reduce((sum, n) => sum + n, 0) - row.pay) < 0.02);
  }
});

test('report values win over personal entries, all monthly corrections are used, other years excluded', () => {
  const reports = [
    report('2026-01', {
      totals: { openingBalance: 20, actualHours: 170, contractualTarget: 160, bdCount: 2 },
      wageTypes: { night: 10 }
    }),
    report('2025-12')
  ];
  const data = page({
    reports,
    entries: [entry({ date: '2026-01-01' })],
    settlements: [{ ...emptySettlement('2026-01'), adjustmentHours: 7 }]
  });
  const annual = yearOverview(data, 2026);
  assert.equal(annual.monthCount, 1);
  assert.equal(annual.months[0].balance, 37);
  assert.equal(annual.months[0].standby, 2);
  assert.equal(annual.months[0].source, 'report');
  assert.equal(annual.months[0].overtime, null, 'account plus cannot invent overtime');
  assert.deepEqual(data.reports, reports);
});

test('configured service phases count once and personal pay components reconcile with monthly pay', () => {
  const meta = { dutyName: 'Nachtdienst', dutyDate: '2026-07-01', bdLevel: 'I' as const };
  const entries = [
    entry({ meta }),
    entry({ date: '2026-07-02', start: '00:00', end: '05:00', meta }),
    entry({ kind: 'oncall', date: '2026-07-05', start: '08:00', end: '20:00' })
  ];
  const data = page({ entries });
  const annual = yearOverview(data, 2026),
    row = annual.months[6];
  assert.equal(row.standby, 1);
  assert.equal(row.oncall, 1);
  assert.equal(row.pay, calculate(entries, rules, '2026-07', data.settlement).expectedPay);
  assert.ok(Math.abs(Object.values(row.components).reduce((sum, n) => sum + n, 0) - row.pay!) < 0.02);
  assert.equal(row.overtime, null);
  assert.equal(annual.months[7].source, 'missing');
});

test('overnight duties span months but previous-month absences cannot create a data month', () => {
  const data = page({
    entries: [
      entry({ date: '2026-06-30', start: '20:00', end: '08:00' }),
      entry({ date: '2026-08-31', kind: 'rest', start: '', end: '' })
    ]
  });
  const annual = yearOverview(data, 2026);
  assert.equal(annual.months[6].source, 'personal');
  assert.equal(annual.months[6].standby, 0, 'service counted in starting month');
  assert.equal(annual.months[8].source, 'missing');
});

test('unavailable tariff/pay foundations are excluded from the mean and pie', () => {
  const annual = yearOverview(
    page({ reports: [report('2026-01', { wageTypes: {} }), report('2026-03', { wageTypes: { night: 10 } })] }),
    2026
  );
  assert.equal(annual.months[0].pay, null);
  assert.equal(annual.payMonthCount, 1);
  assert.equal(annual.averagePay, annual.months[2].pay);
  assert.equal(
    annual.components.reduce((sum, c) => sum + c.amount, 0),
    annual.totalPay
  );
  const empty = yearOverview(page(), 2026);
  assert.equal(empty.averagePay, null);
  assert.equal(empty.totalPay, null);
  assert.deepEqual(empty.components, []);
});

test('personal and reported supplements merge into the same annual categories without double counting', () => {
  const customRules = { ...rules, tariff: false, hourlyRate: 10, holidays: ['2026-08-02'] };
  const entries = [
    entry({ date: '2026-07-05', kind: 'work', start: '20:00', end: '22:00', meta: {} }), // Covered by July report.
    entry({ date: '2026-08-02', kind: 'work', start: '20:00', end: '22:00', meta: {} }),
    entry({ date: '2026-08-09', kind: 'work', start: '20:00', end: '22:00', meta: {} })
  ];
  const annual = yearOverview(
    page({
      rules: customRules,
      entries,
      reports: [report('2026-07', { wageTypes: { night: 1, sunday: 2, holiday35: 3, overtimeBonus: 0 } })]
    }),
    2026
  );
  assert.equal(annual.months[6].pay, 17.5);
  assert.equal(annual.months[7].pay, 20);
  assert.equal(annual.totalPay, 37.5);
  assert.deepEqual(
    annual.components.map(c => [c.key, c.amount, c.average]),
    [
      ['night', 10, 5],
      ['weekend', 10, 5],
      ['holiday', 17.5, 8.75]
    ]
  );
  for (const row of annual.months.filter(row => row.pay !== null)) {
    assert.equal(
      Math.round(Object.values(row.components).reduce((sum, amount) => sum + amount, 0) * 100),
      Math.round(row.pay! * 100)
    );
  }
});

test('annual personal-month balances use the same consecutive carry as the month view', () => {
  const customRules = { ...rules, tariff: false, dailyHours: [0, 0, 0, 0, 0, 0, 0] };
  const entries = ['2026-08-03', '2026-09-01'].map(date =>
    entry({ date, kind: 'work', start: '08:00', end: '16:00', meta: {} })
  );
  const annual = yearOverview(
    page({ rules: customRules, entries, reports: [report('2026-07', { totals: { closingBalance: 50 } })] }),
    2026
  );
  assert.ok(Math.abs(annual.months[7].balance! - 58) < 1e-8);
  assert.ok(Math.abs(annual.months[8].balance! - 66) < 1e-8);
});
