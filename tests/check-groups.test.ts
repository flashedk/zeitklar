import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStandbyChecks } from '../src/lib/check-groups';
import type { ReviewCheck } from '../src/lib/review';

const check = (title: string, values: Partial<ReviewCheck> = {}): ReviewCheck => ({
  title,
  expected: 3.8,
  reported: 3.8,
  unit: 'h',
  status: 'ok',
  detail: 'Original detail',
  key: title,
  acknowledgedAt: null,
  ...values
});

test('three BD days become one 11.40 h summary beside duration and count, retaining child review keys', () => {
  const children = ['16', '22', '30'].map(day => check(`2026-06-${day}: BD-Grundbewertung`));
  const checks = [
    check('BD-Dauer: Tageswerte / Monatssumme'),
    check('BD-Anzahl: Tageswerte / Monatssumme'),
    check('Nachtstunden: regulär + BD'),
    ...children
  ];
  const original = structuredClone(checks);
  const rows = groupStandbyChecks(checks);
  assert.deepEqual(
    rows.map(row => row.check.title),
    [checks[0].title, checks[1].title, 'BD-Grundbewertung gesamt', checks[2].title]
  );
  assert.equal(rows[2].check.expected, 11.4);
  assert.equal(rows[2].check.reported, 11.4);
  assert.equal(rows[2].check.status, 'ok');
  assert.deepEqual(
    rows[2].children?.map(child => child.key),
    children.map(child => child.key)
  );
  assert.equal(rows[2].check.key, '', 'display summary must not get an acknowledgement action');
  assert.deepEqual(checks, original);
});

test('offsetting daily discrepancies still make the overall group a discrepancy', () => {
  const rows = groupStandbyChecks([
    check('2026-06-16: BD-Grundbewertung', { expected: 4, reported: 3, status: 'difference' }),
    check('2026-06-22: BD-Grundbewertung', { expected: 3, reported: 4, status: 'difference' })
  ]);
  assert.equal(rows[0].check.expected, rows[0].check.reported);
  assert.equal(rows[0].check.status, 'difference');
});

test('unknown inputs stay unknown and the summary is quittiert only when every review child is quittiert', () => {
  const children = [
    check('2026-06-16: BD-Grundbewertung', {
      expected: null,
      status: 'review',
      acknowledgedAt: '2026-10-07T12:00:00.000Z'
    }),
    check('2026-06-22: BD-Grundbewertung', { status: 'review' })
  ];
  assert.equal(groupStandbyChecks(children)[0].check.expected, null);
  assert.equal(groupStandbyChecks(children)[0].check.status, 'review');
  assert.equal(groupStandbyChecks(children)[0].check.acknowledgedAt, null);
  children[1].acknowledgedAt = '2026-10-07T13:00:00.000Z';
  assert.equal(groupStandbyChecks(children)[0].check.acknowledgedAt, children[1].acknowledgedAt);
});

test('checks without daily evaluations retain order and duration is used as a fallback anchor', () => {
  const ordinary = [check('Istzeit'), check('BD-Dauer: Tageswerte / Monatssumme')];
  assert.deepEqual(
    groupStandbyChecks(ordinary),
    ordinary.map(check => ({ check }))
  );
  const rows = groupStandbyChecks([...ordinary, check('Nachtstunden'), check('2026-06-16: BD-Grundbewertung')]);
  assert.equal(rows[2].check.title, 'BD-Grundbewertung gesamt');
});
