import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  dailyTargetHours,
  defaultRules,
  effectiveRules,
  emptySettlement,
  mergeRulesAt,
  rulesAt,
  setRulesAt,
  splitRulesAt,
  validateRules,
  versionRange,
  type Rules
} from '../src/lib/model';
import { calculate } from '../src/lib/calculate';
import { effectiveHolidays } from '../src/lib/holidays';
import { tariffProfile } from '../src/lib/tariff';
import { runAction } from '../src/lib/actions';
import { mutate, readSnapshot } from '../browser/store';

const base: Rules = { ...defaultRules, federalState: 'NW', confirmed: true, group: '2', stage: 3 };

test('without history every month uses the same profile and nothing changes', () => {
  assert.equal(rulesAt(base, '2020-01'), base);
  assert.deepEqual(versionRange(base, '2026-09'), { from: null, until: null });
  assert.equal(JSON.stringify(effectiveRules(base, '2026-09')), JSON.stringify(base), 'content keys stay stable');
});

test('a split starts a new version; editing it leaves earlier months untouched', () => {
  const split = splitRulesAt(base, '2026-09');
  assert.deepEqual(versionRange(split, '2026-08'), { from: null, until: '2026-08' });
  assert.deepEqual(versionRange(split, '2026-09'), { from: '2026-09', until: null });
  assert.equal(splitRulesAt(split, '2026-09'), split, 'splitting at an existing boundary is a no-op');
  const edited = setRulesAt(split, '2026-09', {
    ...effectiveRules(split, '2026-09'),
    dailyHours: [0, 4, 4, 4, 4, 4, 0]
  });
  assert.equal(dailyTargetHours(edited, '2026-08-03'), 8);
  assert.equal(dailyTargetHours(edited, '2026-09-07'), 4);
  // Editing the old version only changes the old months.
  const old = setRulesAt(edited, '2026-03', { ...effectiveRules(edited, '2026-03'), stage: 4 });
  assert.equal(tariffProfile(old, '2026-03').stage, 4);
  assert.equal(tariffProfile(old, '2026-10').stage, 3);
  assert.equal(dailyTargetHours(old, '2026-09-07'), 4);
});

test('a version in the middle can be split again and boundaries can be merged away', () => {
  const two = splitRulesAt(splitRulesAt(base, '2026-01'), '2027-01');
  assert.deepEqual(
    two.previous!.map(v => v.validUntil),
    ['2025-12', '2026-12']
  );
  const three = splitRulesAt(two, '2026-07');
  assert.deepEqual(versionRange(three, '2026-08'), { from: '2026-07', until: '2026-12' });
  const merged = mergeRulesAt(three, '2026-07');
  assert.deepEqual(versionRange(merged, '2026-08'), { from: '2026-01', until: '2026-12' });
  assert.throws(() => mergeRulesAt(merged, '2026-05'), /keine Fassungsgrenze/);
  assert.equal(mergeRulesAt(splitRulesAt(base, '2026-01'), '2026-01').previous, undefined);
});

test('global settings stay shared across versions', () => {
  const split = splitRulesAt(
    { ...base, openingMonth: '2026-01', openingHours: 5, openingHoursEntered: true },
    '2026-09'
  );
  const edited = setRulesAt(split, '2026-03', {
    ...effectiveRules(split, '2026-03'),
    openingHours: 12,
    nightPercent: 30
  });
  assert.equal(rulesAt(edited, '2026-10').openingHours, 12, 'opening anchor is global');
  assert.equal(rulesAt(edited, '2026-10').nightPercent, 20, 'surcharge is versioned');
  assert.equal(rulesAt(edited, '2026-03').nightPercent, 30);
});

test('holidays follow the federal state in effect for each month', () => {
  // Lower Saxony until June, Bavaria afterwards: 6 January is Bavarian only, 31 October Lower Saxon only.
  const split = splitRulesAt({ ...base, federalState: 'NI' }, '2026-07');
  const moved = setRulesAt(split, '2026-07', { ...effectiveRules(split, '2026-07'), federalState: 'BY' });
  const holidays = effectiveHolidays(moved, 2026);
  assert.ok(!holidays.includes('2026-01-06'), 'Epiphany falls into the Lower Saxony months');
  assert.ok(!holidays.includes('2026-10-31'), 'Reformation Day falls into the Bavarian months');
  assert.ok(holidays.includes('2026-12-25'));
  assert.ok(effectiveHolidays({ ...base, federalState: 'BY' }, 2026).includes('2026-01-06'));
});

test('monthly calculation uses the version of its month', () => {
  const split = splitRulesAt({ ...base, tariff: false, nightPercent: 20 }, '2026-09');
  const edited = setRulesAt(split, '2026-09', {
    ...effectiveRules(split, '2026-09'),
    dailyHours: [0, 0, 0, 0, 0, 0, 0]
  });
  assert.equal(
    calculate([], edited, '2026-08', emptySettlement('2026-08')).target,
    calculate([], base, '2026-08', emptySettlement('2026-08')).target
  );
  assert.equal(calculate([], edited, '2026-09', emptySettlement('2026-09')).target, 0);
});

test('validation rejects unordered or invalid versions and keeps valid ones', () => {
  const split = splitRulesAt(splitRulesAt(base, '2026-01'), '2026-06');
  assert.deepEqual(validateRules(split).previous, split.previous);
  assert.throws(() => validateRules({ ...split, previous: [...split.previous!].reverse() }), /aufsteigende/);
  assert.throws(
    () =>
      validateRules({
        ...split,
        previous: [{ validUntil: '2026-01', profile: { ...split.previous![0].profile, group: '9' } }]
      }),
    /Tarifauswahl/
  );
  assert.equal(validateRules(base).previous, undefined);
});

test('the rules actions edit one version and split or merge at a month', async () => {
  const store = { mutate, extractPdf: async () => '' };
  const form = (fields: Record<string, string>) => {
    const value = new FormData();
    for (const [key, field] of Object.entries(fields)) value.set(key, field);
    return value;
  };
  await mutate(s => {
    s.rules = base;
  });
  await runAction('rules-version', form({ month: '2026-09', operation: 'split' }), store);
  const afterSplit = (await readSnapshot()).rules;
  await runAction(
    'rules',
    form({ month: '2026-09', rules: JSON.stringify({ ...effectiveRules(afterSplit, '2026-09'), nightPercent: 40 }) }),
    store
  );
  const rules = (await readSnapshot()).rules;
  assert.equal(rulesAt(rules, '2026-09').nightPercent, 40);
  assert.equal(rulesAt(rules, '2026-08').nightPercent, 20);
  await runAction('rules-version', form({ month: '2026-09', operation: 'merge' }), store);
  const merged = (await readSnapshot()).rules;
  assert.equal(merged.previous, undefined);
  assert.equal(rulesAt(merged, '2026-01').nightPercent, 40, 'the later version now covers all months');
  await assert.rejects(
    runAction('rules-version', form({ month: '2026-09', operation: 'drop' }), store),
    /Ungültige Aktion/
  );
});
