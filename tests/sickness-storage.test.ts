import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import 'fake-indexeddb/auto';
import { defaultRules, type Entry } from '../src/lib/model';
import type { TimeReport } from '../src/lib/report';
import {
  addEntries,
  addReport,
  getPage,
  mutate,
  readSnapshot,
  restore,
  setReviewAcknowledgement
} from '../browser/store';
mkdirSync('tmp', { recursive: true });
process.env.DATA_DIR = mkdtempSync(resolve('tmp/sickness-storage-'));
const db = await import('../src/lib/server/db');
Object.defineProperty(globalThis, 'location', {
  value: new URL('https://local.example/?month=2026-02'),
  configurable: true
});
const rules = {
  ...defaultRules,
  tariff: false,
  confirmed: true,
  federalState: 'NW',
  rateMode: 'manual' as const,
  hourlyRate: 100
};
const entries: Entry[] = [
  {
    date: '2026-02-16',
    start: '',
    end: '',
    kind: 'sick',
    breakMinutes: 0,
    note: 'FZA',
    meta: { sickPayEligible: false }
  },
  { date: '2026-02-17', start: '', end: '', kind: 'sick', breakMinutes: 0, note: '', meta: {} }
];
const report = (period: string, night: number): TimeReport => ({
  period,
  printedAt: period + '-28',
  filename: 'Test.txt',
  days: [],
  totals: {},
  wageTypes: { night },
  transfers: [],
  issues: [],
  warnings: [],
  rawText: ''
});
const reports = [report('2025-11', 20), report('2025-12', 20), report('2026-01', 25)];

test('SQLite supports automatic sick pay and payout receipts without a current employer report', () => {
  db.saveRules(rules);
  reports.forEach(db.saveReport);
  db.saveEntries(entries, 'Test');
  let page = db.getReviewData('2026-02');
  assert.equal(page.report, null);
  const review = page.review!,
    check = review.employerChecks.find(c => c.title.startsWith('Auszahlung:'))!;
  assert.equal(check.expected, 20);
  assert.equal(review.employerChecks[0].expected, 1);
  db.setReviewAcknowledgement(review.reportKey, check.key, true);
  page = db.getReviewData('2026-02');
  assert.ok(!page.reviewMonths.includes('2026-02'));
  assert.ok(page.review!.employerChecks.find(c => c.key === check.key)!.acknowledgedAt);
  db.saveReport(report('2026-01', 26));
  assert.ok(db.getReviewData('2026-02').reviewMonths.includes('2026-02'));
  assert.throws(() => db.setReviewAcknowledgement(review.reportKey, check.key, true), /veraltet/);
  assert.equal(db.exportData().entries[0].meta?.sickPayEligible, false);
});

test('IndexedDB preserves the FZA override and automatic receipt; changed references reopen payout', async () => {
  await mutate(s => {
    s.rules = rules;
    reports.forEach(r => addReport(s, r));
    addEntries(s, entries, 'Test');
  });
  const page = await getPage(),
    review = page.review!,
    check = review.employerChecks.find(c => c.title.startsWith('Auszahlung:'))!;
  assert.equal(page.report, null);
  assert.equal(check.expected, 20);
  await mutate(s => setReviewAcknowledgement(s, review.reportKey, check.key, true));
  assert.ok(!(await getPage()).reviewMonths.includes('2026-02'));
  assert.equal((await readSnapshot()).entries[0].meta?.sickPayEligible, false);
  await mutate(s => setReviewAcknowledgement(s, review.reportKey, check.key, false));
  assert.ok((await getPage()).reviewMonths.includes('2026-02'));
  await mutate(s => setReviewAcknowledgement(s, review.reportKey, check.key, true));
  await mutate(s => addReport(s, report('2026-01', 26)));
  assert.ok((await getPage()).reviewMonths.includes('2026-02'));
  await assert.rejects(
    mutate(s => setReviewAcknowledgement(s, review.reportKey, check.key, true)),
    /veraltet/
  );
});

const leaveEntries: Entry[] = [
  {
    date: '2026-10-05',
    start: '',
    end: '',
    kind: 'vacation',
    breakMinutes: 0,
    note: '',
    meta: { vacationPayEligible: true }
  },
  {
    date: '2026-10-06',
    start: '',
    end: '',
    kind: 'vacation',
    breakMinutes: 0,
    note: 'FZA',
    meta: { vacationPayEligible: false }
  }
];
const leaveReports = [report('2026-07', 20), report('2026-08', 20), report('2026-09', 25)];

test('SQLite vacation without a current report is reviewable and its payout acknowledgement is durable', () => {
  leaveReports.forEach(db.saveReport);
  db.saveEntries(leaveEntries, 'Urlaubstest');
  let page = db.getReviewData('2026-10');
  assert.equal(page.report, null);
  const review = page.review!,
    check = review.employerChecks.find(c => c.title === 'Auszahlung: Entgeltfortzahlung Urlaub')!;
  assert.equal(check.expected, 20);
  assert.equal(review.employerChecks.find(c => c.title === 'Urlaubstage')!.expected, 1);
  assert.ok(page.reviewMonths.includes('2026-10'));
  db.setReviewAcknowledgement(review.reportKey, check.key, true);
  page = db.getReviewData('2026-10');
  assert.ok(!page.reviewMonths.includes('2026-10'));
  assert.ok(page.review!.employerChecks.find(c => c.key === check.key)!.acknowledgedAt);
  db.setReviewAcknowledgement(review.reportKey, check.key, false);
  assert.ok(db.getReviewData('2026-10').reviewMonths.includes('2026-10'));
  assert.equal(db.exportData().entries.find(e => e.date === '2026-10-06')!.meta?.vacationPayEligible, false);
});

test('IndexedDB vacation plan flags and payout receipts survive backup restoration', async () => {
  Object.defineProperty(globalThis, 'location', {
    value: new URL('https://local.example/?month=2026-10'),
    configurable: true
  });
  await mutate(s => {
    leaveReports.forEach(r => addReport(s, r));
    addEntries(s, leaveEntries, 'Urlaubstest');
  });
  const page = await getPage(),
    review = page.review!,
    check = review.employerChecks.find(c => c.title === 'Auszahlung: Entgeltfortzahlung Urlaub')!;
  assert.equal(check.expected, 20);
  assert.equal(review.employerChecks.find(c => c.title === 'Urlaubstage')!.expected, 1);
  await mutate(s => setReviewAcknowledgement(s, review.reportKey, check.key, true));
  const backup = await readSnapshot();
  await mutate(s => {
    s.entries = [];
    s.reports = [];
    s.acknowledgements = [];
  });
  await restore(JSON.stringify(backup));
  const restored = await getPage();
  assert.ok(!restored.reviewMonths.includes('2026-10'));
  assert.equal(restored.entries.find(e => e.date === '2026-10-06')!.meta?.vacationPayEligible, false);
  assert.ok(restored.review!.employerChecks.find(c => c.key === check.key)!.acknowledgedAt);
  await mutate(s => addReport(s, report('2026-09', 26)));
  assert.ok((await getPage()).reviewMonths.includes('2026-10'));
});
