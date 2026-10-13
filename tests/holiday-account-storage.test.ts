import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import 'fake-indexeddb/auto';
import { defaultRules } from '../src/lib/model';
import type { TimeReport } from '../src/lib/report';
import { addReport, getPage, mutate } from '../browser/store';
mkdirSync('tmp', { recursive: true });
process.env.DATA_DIR = mkdtempSync(resolve('tmp/holiday-account-storage-'));
const db = await import('../src/lib/server/db');
Object.defineProperty(globalThis, 'location', {
  value: new URL('https://local.example/?month=2026-05'),
  configurable: true
});
const rules = { ...defaultRules, confirmed: true, federalState: 'NW' };
const prior: TimeReport = {
  period: '2026-04',
  printedAt: '2026-04-28',
  filename: 'April.txt',
  days: [],
  totals: { holidayBalance: 0 },
  wageTypes: {},
  issues: [],
  transfers: [],
  warnings: [],
  rawText: ''
};
const current: TimeReport = {
  ...prior,
  period: '2026-05',
  printedAt: '2026-05-28',
  filename: 'Mai.txt',
  totals: { holidayBalance: 11.5, holidayTimeOffHours: 0, holidayPaidHours: 0 },
  wageTypes: { holiday35: 11.5, holiday135: 0 },
  days: [
    {
      date: '2026-05-14',
      label: 'Do',
      plannedHours: 8,
      actualHours: 11.5,
      holidayHours: 11.5,
      overtimeHours: null,
      standbyHours: null,
      standbyWeightedHours: null,
      standbyCount: null,
      nightHours: null,
      saturdayHours: null,
      sundayHours: null,
      spans: [],
      rawLines: []
    }
  ]
};

test('SQLite review uses the previous holiday account, and the latest source revision changes the calculation', () => {
  db.saveRules(rules);
  db.saveReport(prior);
  db.saveReport(current);
  const before = db
    .getReviewData('2026-05')
    .review!.employerChecks.find(c => c.title === 'Freizeitkonto Feiertagsarbeit')!;
  assert.equal(before.expected, 11.5);
  assert.equal(before.status, 'ok');
  db.saveReport({ ...prior, totals: { holidayBalance: 2 } });
  const changed = db.getReviewData('2026-05').review!.employerChecks.find(c => c.title === before.title)!;
  assert.equal(changed.expected, 13.5);
  assert.equal(changed.status, 'difference');
  assert.notEqual(changed.key, before.key);
});

test('browser review receives prior holiday balances and latest revisions too', async () => {
  await mutate(s => {
    s.rules = rules;
    addReport(s, prior);
    addReport(s, current);
  });
  const before = (await getPage()).review!.employerChecks.find(c => c.title === 'Freizeitkonto Feiertagsarbeit')!;
  assert.equal(before.expected, 11.5);
  assert.equal(before.status, 'ok');
  await mutate(s => addReport(s, { ...prior, totals: { holidayBalance: 2 } }));
  const changed = (await getPage()).review!.employerChecks.find(c => c.title === before.title)!;
  assert.equal(changed.expected, 13.5);
  assert.equal(changed.status, 'difference');
  assert.notEqual(changed.key, before.key);
});
