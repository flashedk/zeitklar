import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules, migrateRules, validateRules } from '../src/lib/model';
import {
  emptyDutyTemplate,
  isCompleteDutyTemplate,
  isEmptyDutyTemplate,
  type DutyTemplate
} from '../src/lib/duty-templates';

const nightDuty: DutyTemplate = {
  name: 'Nachtdienst',
  regularHours: 8,
  standbyHours: 14,
  secondRegularHours: 2,
  bdLevel: 'II'
};

test('legacy profiles get an empty duty list and mixed duty phases survive validation', () => {
  const { dutyTemplates, ...legacy } = defaultRules;
  assert.deepEqual(migrateRules(legacy).dutyTemplates, []);
  assert.deepEqual(validateRules(legacy).dutyTemplates, []);
  assert.deepEqual(validateRules({ ...defaultRules, dutyTemplates: [nightDuty] }).dutyTemplates, [nightDuty]);
  assert.equal(isCompleteDutyTemplate({ ...nightDuty, regularHours: 8, standbyHours: 0, secondRegularHours: 0 }), true);
});

test('only untouched empty rows are omitted; partial or invalid rows are not complete', () => {
  assert.equal(isEmptyDutyTemplate(emptyDutyTemplate()), true);
  assert.equal(isCompleteDutyTemplate(emptyDutyTemplate()), false);
  for (const partial of [
    { ...emptyDutyTemplate(), name: 'Nachtdienst' },
    { ...emptyDutyTemplate(), standbyHours: 8 },
    { ...nightDuty, regularHours: undefined }
  ]) {
    assert.equal(isEmptyDutyTemplate(partial as DutyTemplate), false);
    assert.equal(isCompleteDutyTemplate(partial as DutyTemplate), false);
  }
});

test('invalid configured duties are rejected before settings can be saved', () => {
  for (const invalid of [
    null,
    {},
    { ...nightDuty, name: ' ' },
    { ...nightDuty, name: 'x'.repeat(101) },
    { ...nightDuty, regularHours: -1 },
    { ...nightDuty, standbyHours: NaN },
    { ...nightDuty, secondRegularHours: undefined },
    { ...nightDuty, standbyHours: 15 },
    { ...nightDuty, bdLevel: 'III' },
    { ...emptyDutyTemplate(), name: 'Leer' }
  ]) {
    assert.throws(() => validateRules({ ...defaultRules, dutyTemplates: [invalid] }));
  }
  assert.throws(() => validateRules({ ...defaultRules, dutyTemplates: {} }));
  assert.throws(() => validateRules({ ...defaultRules, dutyTemplates: null }));
});
