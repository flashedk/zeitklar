import assert from 'node:assert/strict';
import test from 'node:test';
import { stageCount, tariffProfile, tariffRate } from '../src/lib/tariff';
import { calculate } from '../src/lib/calculate';
import { auditReport } from '../src/lib/audit';
import {
  dailyTargetHours,
  defaultRules,
  emptySettlement,
  migrateRules,
  validateRules,
  weeklyHours,
  type Rules
} from '../src/lib/model';
import type { TimeReport } from '../src/lib/report';

const profile = (overrides: Partial<Rules> = {}): Rules => ({ ...defaultRules, federalState: 'NI', ...overrides });
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

test('all groups and stages use verified table A/B by service month', () => {
  const a = [
    [5792.9, 6121.26, 6355.79, 6762.34, 7247.0, 7436.05],
    [7645.72, 8286.77, 8849.64, 9165.95, 9338.38, 9576.69],
    [9576.69, 10139.57, 10944.77, 11265.33],
    [11265.33, 12070.52, 12711.58]
  ];
  const b = [
    [5934.83, 6271.23, 6511.51, 6928.02, 7424.55, 7618.23],
    [7833.04, 8489.8, 9066.46, 9390.52, 9567.17, 9811.32],
    [9811.32, 10387.99, 11212.92, 11541.33],
    [11541.33, 12366.25, 13023.01]
  ];
  for (const [i, values] of a.entries()) {
    const group = String(i + 1) as Rules['group'];
    assert.equal(stageCount(group), values.length);
    for (const [j, monthly] of values.entries()) {
      const rules = profile({ group, stage: j + 1 });
      const april = tariffProfile(rules, '2026-04'),
        september = tariffProfile(rules, '2027-09');
      assert.equal(april.monthlyPay, monthly);
      assert.equal(april.individualRate, cents(monthly / 173.92));
      assert.equal(september.monthlyPay, b[i][j]);
      assert.equal(september.individualRate, cents(b[i][j] / 173.92));
      assert.equal(april.bonusRate, cents(values[2] / 173.92));
      assert.equal(april.overtimeBaseRate, cents(values[Math.min(j, 3)] / 173.92));
    }
  }
});

test('the next advancement changes pay from the beginning of its month', () => {
  const rules = profile({ group: '2', stage: 1, nextAdvanceDate: '2026-07-15' });
  const before = tariffProfile(rules, '2026-06');
  assert.equal(before.stage, 1);
  assert.equal(before.nextAdvance, '2026-07-15');
  const after = tariffProfile(rules, '2026-07');
  assert.equal(after.stage, 2);
  assert.equal(after.monthlyPay, 8286.77);
  assert.equal(after.nextAdvance, '2029-07-15');
  assert.equal(tariffProfile(rules, '2029-06').stage, 2);
  const third = tariffProfile(rules, '2029-07');
  assert.equal(third.stage, 3);
  assert.equal(third.nextAdvance, '2031-07-15');
  assert.equal(tariffProfile(rules, '2033-07').stage, 5);
  const end = tariffProfile(rules, '2035-07');
  assert.equal(end.stage, 6);
  assert.equal(end.nextAdvance, null);
});

test('blank dates fix selected stage; end stage never creates a further advancement', () => {
  assert.equal(tariffProfile(profile({ group: '3', stage: 2 }), '2040-01').stage, 2);
  assert.equal(
    tariffProfile(profile({ group: '4', stage: 3, nextAdvanceDate: '2026-07-15' }), '2026-06').nextAdvance,
    null
  );
  assert.equal(
    tariffProfile(profile({ group: '1', stage: 1, nextAdvanceDate: '2028-02-29' }), '2028-02').nextAdvance,
    '2029-02-28'
  );
});

test('migration preserves older manual rates while fresh profiles default to table', () => {
  const { stage, nextAdvanceDate, rateMode, ...legacy } = profile({ individualRate: 42.5, overtimeBaseRate: 40.1 });
  const migrated = migrateRules(legacy);
  assert.equal(migrated.rateMode, 'manual');
  assert.equal(migrated.individualRate, 42.5);
  assert.equal(migrated.overtimeBaseRate, 40.1);
  assert.equal(tariffProfile(migrated, '2026-07').individualRate, 42.5);
  assert.equal(defaultRules.rateMode, 'table');
  assert.equal(defaultRules.stage, 1);
  assert.equal(validateRules(legacy).rateMode, 'manual');
});

test('manual mode preserves amounts while exposing stage progression independently', () => {
  const p = tariffProfile(
    profile({
      group: '1',
      stage: 1,
      nextAdvanceDate: '2026-07-15',
      rateMode: 'manual',
      individualRate: 42.5,
      overtimeBaseRate: 40.1
    }),
    '2026-08'
  );
  assert.equal(p.stage, 2);
  assert.equal(p.individualRate, 42.5);
  assert.equal(p.overtimeBaseRate, 40.1);
  assert.equal(p.monthlyPay, null);
  assert.equal(p.bonusRate, 36.54);
});

test('invalid groups, stages, months and dates cannot silently select a tariff amount', () => {
  assert.throws(() => stageCount('5' as Rules['group']));
  for (const stage of [0, 4, 1.5, NaN]) {
    assert.throws(() => tariffProfile(profile({ group: '4', stage }), '2026-07'));
    assert.throws(() => validateRules(profile({ group: '4', stage })));
  }
  assert.throws(() => tariffRate('1', '2026-13'));
  assert.throws(() => tariffProfile(profile({ nextAdvanceDate: '2026-02-29' }), '2026-07'));
  assert.throws(() => validateRules(profile({ nextAdvanceDate: '2026-02-29' })));
});

test('older table amounts remain unavailable and are not copied from April 2026', () => {
  const p = tariffProfile(profile(), '2023-09');
  assert.equal(p.monthlyPay, null);
  assert.equal(p.individualRate, null);
  assert.equal(p.overtimeBaseRate, null);
  assert.equal(p.bonusRate, null);
  assert.equal(tariffRate('1', '2023-09'), null);
  assert.ok(p.warnings.some(w => w.includes('nicht verfügbar')));
  const result = calculate([], profile(), '2023-09', emptySettlement('2023-09'));
  assert.equal(result.payAvailable, false);
});

test('verified historical tables apply at their own boundaries and full-time weekly divisor', () => {
  const rules = profile({ group: '1', stage: 3 });
  const dates: [string, number, number][] = [
    ['2023-10', 5600.21, 42],
    ['2024-03', 5600.21, 42],
    ['2024-04', 5824.22, 42],
    ['2025-01', 5824.22, 42],
    ['2025-02', 6173.67, 42],
    ['2025-12', 6173.67, 42],
    ['2026-01', 6173.67, 40],
    ['2026-03', 6173.67, 40],
    ['2026-04', 6355.79, 40]
  ];
  for (const [month, monthlyPay, weekly] of dates) {
    const p = tariffProfile(rules, month);
    assert.equal(p.monthlyPay, monthlyPay);
    assert.equal(p.fullWeeklyHours, weekly);
    assert.equal(p.divisor, 4.348 * weekly);
    assert.equal(p.individualRate, cents(monthlyPay / (4.348 * weekly)));
  }
});

test('historical Ä3 stage4 is unavailable before its introduction in January 2026', () => {
  const rules = profile({ group: '3', stage: 4 });
  const before = tariffProfile(rules, '2025-12');
  assert.equal(before.monthlyPay, null);
  assert.equal(before.individualRate, null);
  assert.equal(before.overtimeBaseRate, null);
  assert.equal(before.bonusRate, cents(10631.15 / (4.348 * 42)));
  assert.equal(tariffRate('3', '2025-12', 4), null);
  assert.equal(tariffProfile(rules, '2026-01').monthlyPay, 10942.53);
  const result = calculate(
    [
      {
        date: '2025-12-01',
        start: '08:00',
        end: '09:00',
        kind: 'standby',
        breakMinutes: 0,
        note: '',
        meta: { bdLevel: 'I' }
      }
    ],
    rules,
    '2025-12',
    emptySettlement('2025-12')
  );
  assert.equal(result.payAvailable, false);
});

test('Ä2 backward history uses stage3 two years and stage2 three years correctly', () => {
  const rules = profile({ group: '2', stage: 4, nextAdvanceDate: '2028-07-15' });
  // Stage4 starts2026-07; stage3 starts2024-07; stage2 starts2021-07.
  assert.equal(tariffProfile(rules, '2026-07').stage, 4);
  assert.equal(tariffProfile(rules, '2026-06').stage, 3);
  assert.equal(tariffProfile(rules, '2024-07').stage, 3);
  const stage2 = tariffProfile(rules, '2024-06');
  assert.equal(stage2.stage, 2);
  assert.equal(stage2.nextAdvance, '2024-07-15');
  assert.equal(tariffProfile(rules, '2021-06').stage, 1);
  assert.ok(stage2.warnings.some(w => w.includes('ununterbrochener') && w.includes('derselben Entgeltgruppe')));
  const beforeEmployment = tariffProfile(rules, '2017-07');
  assert.equal(beforeEmployment.stage, 1);
  assert.ok(beforeEmployment.warnings.some(w => w.includes('Beschäftigungsbeginn') && w.includes('Rechengrenze')));
});

test('selected maximum stage without usable next date does not fabricate an earlier history', () => {
  for (const nextAdvanceDate of ['', '2028-07-15']) {
    const p = tariffProfile(profile({ group: '2', stage: 6, nextAdvanceDate }), '2024-04');
    assert.equal(p.stage, 6);
    assert.equal(p.nextAdvance, null);
    assert.ok(p.warnings.some(w => w.includes('nicht rekonstruiert')));
  }
});

test('optional weekly change scales the after-change distribution and preserves part-time share', () => {
  const rules = profile({ workTimeChangeEnabled: true });
  assert.equal(weeklyHours(rules, '2025-12-29'), 42);
  assert.equal(weeklyHours(rules, '2026-01-02'), 40);
  assert.equal(dailyTargetHours(rules, '2025-12-29'), 8.4);
  assert.equal(dailyTargetHours(rules, '2026-01-02'), 8);
  const partTime = { ...rules, dailyHours: [0, 4, 4, 4, 4, 4, 0] };
  assert.equal(dailyTargetHours(partTime, '2025-12-29'), 4.2);
  assert.equal(tariffProfile(partTime, '2025-12').fullWeeklyHours, 42);
  assert.equal(dailyTargetHours({ ...rules, workTimeChangeEnabled: false }, '2025-12-29'), 8);
  assert.equal(migrateRules({ ...defaultRules }).workTimeChangeEnabled, false);
});

test('weekly basis can change within a month; invalid drafts show no automatic hourly amount', () => {
  const rules = profile({ workTimeChangeEnabled: true, workTimeChangeDate: '2026-07-15' });
  assert.equal(tariffProfile(rules, '2026-07', '2026-07-14').individualRate, cents(5792.9 / (4.348 * 42)));
  assert.equal(tariffProfile(rules, '2026-07', '2026-07-15').individualRate, cents(5792.9 / (4.348 * 40)));
  assert.equal(tariffProfile({ ...rules, weeklyHoursAfter: 0 }, '2026-07', '2026-07-15').individualRate, null);
  assert.throws(() => validateRules({ ...rules, weeklyHoursAfter: 0 }));
  assert.throws(() => validateRules({ ...rules, workTimeChangeDate: '2026-02-29' }));
});

test('automatic rates reach BD, overtime and employer wage estimates', () => {
  const rules = profile({ group: '1', stage: 6, individualRate: 999, overtimeBaseRate: 999 });
  const settlement = { ...emptySettlement('2026-07'), overtimeHours: 1, overtimePaidHours: 1 };
  const entries = [
    {
      date: '2026-07-01',
      start: '08:00',
      end: '09:00',
      kind: 'standby' as const,
      breakMinutes: 0,
      note: '',
      meta: { bdLevel: 'I' as const }
    }
  ];
  const result = calculate(entries, rules, '2026-07', settlement);
  const individual = tariffRate('1', '2026-07', 6)!,
    capped = tariffRate('1', '2026-07', 4)!;
  assert.equal(result.dutyPay, cents(cents(individual * 0.6) + capped));
  assert.equal(result.overtimeBonus, 5.48);
  assert.equal(result.rate, 36.54);
  const report: TimeReport = {
    period: '2026-07',
    printedAt: '2026-09-30',
    filename: 'test',
    days: [],
    totals: {},
    wageTypes: { overtimeBase: 1 },
    transfers: [],
    issues: [],
    warnings: [],
    rawText: ''
  };
  const audit = auditReport(report, rules, settlement);
  assert.equal(audit.payLines.find(p => p.label === 'Überstunden-Grundvergütung')?.rate, capped);
});
