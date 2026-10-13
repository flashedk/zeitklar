import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import 'fake-indexeddb/auto';
import { calculateContinuedPay, emptyContinuedPay, type PayReference, type SickPeriod } from '../src/lib/continued-pay';
import { action } from '../browser/forms';
import { getPage, mutate, readSnapshot, restore } from '../browser/store';
mkdirSync('tmp', { recursive: true });
process.env.DATA_DIR = mkdtempSync(resolve('tmp/continued-pay-storage-'));
const db = await import('../src/lib/server/db');
Object.defineProperty(globalThis, 'location', {
  value: new URL('https://local.example/?month=2026-10'),
  configurable: true
});
const references: PayReference[] = ['2026-07', '2026-08', '2026-09'].map(month => ({
  month,
  amounts: { timeBonus: month === '2026-09' ? 500 : 400, standby: 0, oncall: 0, plannedOvertime: 0, other: 0 },
  excludedAmount: 0,
  excludedDays: 0,
  source: 'Lohnabrechnung',
  sourceKey: '',
  confirmed: true
}));
const period: SickPeriod = {
  id: 'storage',
  start: '2026-10-30',
  end: '2026-11-03',
  days: ['2026-10-30', '2026-11-02', '2026-11-03'],
  workDaysPerWeek: 5,
  employmentStart: '',
  workTimeChange: '',
  divisorOverride: null,
  individualAmount: null,
  individualDays: null,
  adjustments: {},
  confirmed: true,
  note: 'Dienstplan geprüft'
};
const form = (operation: string, value?: unknown) => {
  const f = new FormData();
  f.set('operation', operation);
  if (value !== undefined) f.set('value', JSON.stringify(value));
  return f;
};

test('SQLite continued pay is durable, exported, month-aware, reviewable and rejects overlapping edits atomically', () => {
  assert.deepEqual(db.getContinuedPay(), emptyContinuedPay());
  references.forEach(r => db.updateContinuedPay(form('reference', r)));
  db.updateContinuedPay(form('period', period));
  assert.deepEqual(db.getMonths(), ['2026-11', '2026-10']);
  assert.equal(db.exportData().continuedPay.periods[0].note, 'Dienstplan geprüft');
  const page = db.getReviewData('2026-11');
  assert.deepEqual(page.reviewMonths, ['2026-11', '2026-10']);
  const line = calculateContinuedPay(page.continuedPay, '2026-11', page.reports, page.rules)[0];
  assert.equal(line.amount, 40);
  const ack = form('acknowledge');
  ack.set('month', '2026-11');
  ack.set('key', line.key);
  ack.set('acknowledged', 'true');
  db.updateContinuedPay(ack);
  assert.deepEqual(db.getReviewData('2026-11').reviewMonths, ['2026-10']);
  const review = db.getReviewData('2026-11').review!;
  const payment = review.employerChecks.find(c => c.title.startsWith('Auszahlung: Entgeltfortzahlung'))!;
  db.setReviewAcknowledgement(review.reportKey, payment.key, false);
  assert.ok(db.getReviewData('2026-11').reviewMonths.includes('2026-11'));
  db.setReviewAcknowledgement(review.reportKey, payment.key, true);
  assert.deepEqual(db.getReviewData('2026-11').reviewMonths, ['2026-10']);
  const persisted = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import{DatabaseSync}from'node:sqlite';import{resolve}from'node:path';const d=new DatabaseSync(resolve(process.env.DATA_DIR,'zeitklar.sqlite'));console.log(JSON.parse(d.prepare('SELECT value FROM continued_pay WHERE id=1').get().value).periods[0].id);d.close()"
    ],
    { encoding: 'utf8', env: process.env }
  );
  assert.equal(persisted.trim(), 'storage');
  assert.throws(() => db.updateContinuedPay(form('period', { ...period, id: 'overlap' })), /überschneiden/);
  assert.equal(db.getContinuedPay().periods.length, 1);
  db.updateContinuedPay(form('reference', { ...references[0], amounts: { ...references[0].amounts, timeBonus: 500 } }));
  assert.deepEqual(db.getReviewData('2026-11').reviewMonths, ['2026-11', '2026-10']);
  assert.throws(() => db.updateContinuedPay(ack), /veraltet/);
});
test('local browser actions persist bases and payment control; backup restores data and conflicting merges roll back', async () => {
  for (const r of references) await action('continued-pay', form('reference', r));
  await action('continued-pay', form('period', period));
  const page = await getPage();
  assert.deepEqual(page.months, ['2026-11', '2026-10']);
  assert.ok(page.reviewMonths.includes('2026-10'));
  const line = calculateContinuedPay(page.continuedPay, '2026-10', page.reports, page.rules)[0];
  const ack = form('acknowledge');
  ack.set('month', '2026-10');
  ack.set('key', line.key);
  ack.set('acknowledged', 'true');
  await action('continued-pay', ack);
  assert.ok(calculateContinuedPay((await readSnapshot()).continuedPay!, '2026-10')[0].acknowledgedAt);
  const backup = await readSnapshot();
  await mutate(s => {
    s.continuedPay = emptyContinuedPay();
  });
  await restore(JSON.stringify(backup));
  assert.deepEqual((await readSnapshot()).continuedPay, backup.continuedPay);
  const changed = structuredClone(backup);
  changed.continuedPay!.references[0].amounts.timeBonus = 2;
  changed.entries.push({
    date: '2026-12-01',
    start: '',
    end: '',
    kind: 'sick',
    breakMinutes: 0,
    note: 'Would be inserted before merge conflict'
  });
  await assert.rejects(restore(JSON.stringify(changed)), /abweichende Referenz/);
  assert.equal((await readSnapshot()).entries.length, 0, 'entire backup transaction rolls back');
  assert.throws(() => db.updateContinuedPay(form('period', { ...period, id: 'other', days: ['wrong'] })), /Ungültiger/);
  const bad = form('period', { ...period, id: 'other' });
  await assert.rejects(action('continued-pay', bad), /überschneiden/);
  assert.equal((await readSnapshot()).continuedPay!.periods.length, 1);
  const remove = form('delete');
  remove.set('id', period.id);
  await action('continued-pay', remove);
  assert.deepEqual((await getPage()).reviewMonths, []);
});
