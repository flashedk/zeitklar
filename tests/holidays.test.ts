import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveHolidays, federalStates, getHolidays } from '../src/lib/holidays';
import { defaultRules } from '../src/lib/model';
test('all 16 states have nationwide holidays and correct movable dates in 2026', () => {
  assert.equal(federalStates.length, 16);
  for (const { code } of federalStates) {
    const days = getHolidays(2026, code).map(d => d.date);
    for (const date of ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-14', '2026-05-25', '2026-10-03'])
      assert.ok(days.includes(date), `${code} ${date}`);
    assert.equal(new Set(days).size, days.length);
  }
});
test('regional and local exceptions do not leak into other states', () => {
  const dates = (state: string, options = {}) => getHolidays(2026, state, options).map(h => h.date);
  assert.ok(dates('BY').includes('2026-06-04'));
  assert.ok(!dates('BY').includes('2026-08-15'));
  assert.ok(dates('BY', { assumption: true }).includes('2026-08-15'));
  assert.ok(dates('BY', { augsburg: true }).includes('2026-08-08'));
  assert.ok(!dates('BE', { assumption: true }).includes('2026-08-15'));
  assert.ok(dates('SN').includes('2026-11-18'));
  assert.ok(!dates('SN').includes('2026-06-04'));
  assert.ok(dates('SN', { corpusChristi: true }).includes('2026-06-04'));
  assert.ok(dates('BB').includes('2026-04-05'));
  assert.ok(dates('MV').includes('2026-03-08'));
  assert.ok(dates('TH').includes('2026-09-20'));
});
test('different years recompute Easter; custom holidays are deduplicated', () => {
  assert.ok(getHolidays(2027, 'BW').some(h => h.date === '2027-03-26'));
  const dates = effectiveHolidays(
    { ...defaultRules, federalState: 'BE', holidays: ['2026-01-01', '2026-07-01'] },
    2026
  );
  assert.equal(dates.filter(d => d === '2026-01-01').length, 1);
  assert.ok(dates.includes('2026-07-01'));
});
