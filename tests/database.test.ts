import { julyText, mayText } from './helpers/synthetic-dpl.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseText } from '../src/lib/importer';
import { validateReport } from '../src/lib/validate-report';
import { defaultRules, emptySettlement, validateEntry, type Rules } from '../src/lib/model';
import { tariffProfile } from '../src/lib/tariff';
import { dutyEntries } from '../src/lib/duty-entry';
import { calculate } from '../src/lib/calculate';
mkdirSync('tmp', { recursive: true });
process.env.DATA_DIR = mkdtempSync(resolve('tmp/db-test-'));
const db = await import('../src/lib/server/db');

test('SQLite permits FnD after a night service and persists FzA without inventing work hours', () => {
  const night = { name: 'N', regularHours: 5, standbyHours: 4, secondRegularHours: 1.25, bdLevel: 'II' as const };
  db.saveEntries(dutyEntries(night, '2032-09-13', '21:45', '08:00'), 'Test');
  for (const [date, kind] of [
    ['2032-09-14', 'rest'],
    ['2032-09-15', 'timeoff']
  ] as const) {
    db.saveEntries([validateEntry({ date, kind, start: '', end: '', breakMinutes: 0, note: '' })], 'Test');
  }
  const saved = db.getEntries().filter(e => e.date.startsWith('2032-09'));
  assert.equal(saved.length, 5);
  assert.ok(saved.filter(e => ['rest', 'timeoff'].includes(e.kind)).every(e => e.start === '' && e.breakMinutes === 0));
  for (const e of saved) db.deleteEntry(e.id!);
});
test('SQLite preserves entries, metadata, settings, and monthly reconciliation; rolls back conflicts', () => {
  const entry = validateEntry({
    date: '2026-07-03',
    start: '07:00',
    end: '16:00',
    breakMinutes: 30,
    kind: 'work',
    note: 'Test',
    meta: { pauseStart: '12:00' }
  });
  assert.deepEqual(db.saveEntries([entry], 'Test'), { inserted: 1, duplicates: 0 });
  assert.equal(db.getEntries()[0].meta?.pauseStart, '12:00');
  assert.deepEqual(db.saveEntries([entry], 'Test'), { inserted: 0, duplicates: 1 });
  assert.throws(() => db.saveEntries([{ ...entry, breakMinutes: 45 }], 'Test'), /abweichende/);
  assert.throws(
    () =>
      db.saveEntries(
        [
          { ...entry, date: '2026-07-04' },
          { ...entry, start: '15:00', end: '18:00', meta: {} }
        ],
        'Test'
      ),
    /Überschneidung/
  );
  assert.equal(db.getEntries().length, 1, 'whole batch rolls back');
  const id = db.getEntries()[0].id!;
  db.saveEntries([{ ...entry, end: '17:00' }], 'Edit', id);
  assert.equal(db.getEntries().length, 1);
  assert.equal(db.getEntries()[0].end, '17:00');
  db.saveRules({ ...defaultRules, group: '2', individualRate: 50.88 });
  assert.equal(db.getRules().group, '2');
  db.saveSettlement({ ...emptySettlement('2026-07'), paidBonus: 590.25, openingHours: 71.5 });
  assert.equal(db.getSettlement('2026-07').paidBonus, 590.25);
  assert.deepEqual(db.getMonths(), ['2026-07']);
  assert.equal(db.exportData().entries.length, 1);
  db.deleteEntry(db.getEntries()[0].id!);
  assert.equal(db.getEntries().length, 0);
});
test('Rufbereitschaft can contain a separately recorded hospital callout', () => {
  const base = { date: '2026-07-11', breakMinutes: 0, note: '' };
  db.saveEntries(
    [
      validateEntry({ ...base, kind: 'oncall', start: '18:00', end: '06:00' }),
      validateEntry({ ...base, kind: 'callout', start: '20:00', end: '21:10' })
    ],
    'Test'
  );
  assert.equal(db.getEntries().length, 2);
});
test('24-hour services require an explicit flag; invalid dates and pauses are rejected', () => {
  const base = { date: '2026-07-12', kind: 'standby', start: '08:00', end: '08:00', breakMinutes: 0, note: '' };
  assert.throws(() => validateEntry(base));
  assert.equal(validateEntry({ ...base, meta: { fullDay: true } }).meta?.fullDay, true);
  assert.throws(() => validateEntry({ ...base, date: '2026-02-30' }));
  assert.throws(() => validateEntry({ ...base, end: '10:00', breakMinutes: 30, meta: { pauseStart: '10:00' } }));
});

test('SQLite stores and reloads a DPL report ending at 24:00 on the original date', () => {
  const report = validateReport(parseText(mayText).report!);
  assert.equal(db.saveReport(report), true);
  const stored = db.getReport('2026-05')!;
  assert.equal(stored.days[0].date, '2026-05-12');
  assert.equal(stored.days[0].spans[0].end, '24:00');
  assert.equal(db.saveReport(stored), false);
});

test('SQLite migrates legacy manual hourly rates and persists an automatic stage profile', () => {
  const legacy: Record<string, unknown> = {
    ...defaultRules,
    group: '2',
    individualRate: 57.34,
    overtimeBaseRate: 52.21
  };
  for (const key of ['stage', 'nextAdvanceDate', 'rateMode']) delete legacy[key];
  // Stored by a pre-v2 version of the app.
  db.mutateSync(s => {
    s.rules = legacy as Rules;
    s.schemaVersion = 1;
  });
  assert.equal(db.getRules().rateMode, 'manual');
  assert.equal(tariffProfile(db.getRules(), '2026-07').individualRate, 57.34);
  db.saveRules({ ...db.getRules(), rateMode: 'table', stage: 5, nextAdvanceDate: '2027-05-15' });
  assert.equal(db.getRules().stage, 5);
  assert.equal(db.getRules().nextAdvanceDate, '2027-05-15');
  assert.equal(tariffProfile(db.getRules(), '2027-05').stage, 6);
});

test('SQLite pending queue persists two months, deduplicates and confirms only the chosen report', () => {
  const july = validateReport(parseText(julyText).report!);
  const august = validateReport({
    ...july,
    period: '2026-08',
    days: july.days.map(day => ({ ...day, date: day.date.replace('2026-07', '2026-08') }))
  });
  assert.equal(db.savePendingReport(july), true);
  assert.equal(db.savePendingReport(august), true);
  assert.equal(
    db.savePendingReport({
      ...july,
      filename: 'same.pdf',
      totals: Object.fromEntries(Object.entries(july.totals).reverse())
    }),
    false
  );
  assert.equal(db.getPendingReports().length, 2);
  assert.equal(db.getReport('2026-08'), null, 'unreviewed reports never become final audit input');
  assert.ok(db.getMonths().includes('2026-08'));
  const persisted = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import{DatabaseSync}from'node:sqlite';import{resolve}from'node:path';const d=new DatabaseSync(resolve(process.env.DATA_DIR,'zeitklar.sqlite'));console.log(d.prepare('SELECT COUNT(*) AS n FROM pending_reports').get().n);d.close()"
    ],
    { env: process.env, encoding: 'utf8' }
  );
  assert.equal(Number(persisted.trim()), 2, 'separate process reloads durable queue');
  const julyId = db.getPendingReports().find(value => value.report.period === '2026-07')!.id;
  db.confirmPendingReport(julyId);
  assert.equal(db.getReport('2026-07')?.totals.actualHours, 120);
  assert.deepEqual(
    db.getPendingReports().map(value => value.report.period),
    ['2026-08']
  );
  assert.equal(
    db.savePendingReport({ ...july, filename: 'july.pdf' }),
    false,
    'confirmed PDF/TXT duplicates stay out of queue'
  );
  assert.throws(() => db.confirmPendingReport(julyId), /nicht gefunden/);
  assert.equal(db.getPendingReports().length, 1);
  const backup = db.exportData();
  assert.equal(backup.pendingReports.length, 1);
  db.discardPendingReport(backup.pendingReports[0].id);
  assert.equal(db.getPendingReports().length, 0);
  assert.equal(db.getReport('2026-07')?.rawText, july.rawText, 'discard leaves confirmed data intact');
});

test('SQLite own-time previews persist, edited confirmation is atomic and invalid edits retain source', () => {
  const one = parseText('03.11.2026;07:00;16:00;30', 'november.txt');
  const two = parseText('03.12.2026;07:00;16:00;30', 'december.txt');
  assert.equal(db.savePendingEntryImport(one), true);
  assert.equal(db.savePendingEntryImport(two), true);
  assert.equal(db.savePendingEntryImport({ ...one, filename: 'duplicate.txt' }), false);
  const pending = db.getPendingEntryImports(),
    id = pending[0].id;
  assert.equal(db.exportData().pendingEntryImports.length, 2);
  assert.ok(db.getMonths().includes('2026-12'));
  assert.throws(() => db.confirmPendingEntryImport(id, [{ ...one.entries[0], end: '99:00' }]), /Uhrzeit/);
  assert.equal(db.getPendingEntryImports()[0].preview.text, one.text);
  const before = db.getEntries().length;
  assert.throws(
    () => db.confirmPendingEntryImport(id, [one.entries[0], { ...one.entries[0], start: '15:00', end: '18:00' }]),
    /Überschneidung/
  );
  assert.equal(db.getEntries().length, before, 'conflict rolls back all entries');
  assert.equal(db.getPendingEntryImports().length, 2);
  db.confirmPendingEntryImport(id, [{ ...one.entries[0], breakMinutes: 45 }]);
  assert.equal(db.getEntries().find(entry => entry.date === '2026-11-03')!.breakMinutes, 45);
  assert.equal(db.getPendingEntryImports().length, 1);
  db.discardPendingEntryImport(db.getPendingEntryImports()[0].id);
  assert.equal(db.getPendingEntryImports().length, 0);
});

test('SQLite review acknowledgements survive reload, close only reviewed months and reject stale points', () => {
  const report = {
    period: '2026-09',
    printedAt: '2026-10-06',
    filename: 'September.txt',
    days: [],
    totals: {},
    wageTypes: {},
    transfers: [],
    issues: [],
    warnings: [],
    rawText: 'Synthetischer Zeitnachweis für Quittierungstests.'
  };
  db.saveReport(report);
  db.saveReport({ ...report, period: '2026-10', filename: 'October.txt' });
  const before = db.getReviewData('2026-09');
  const review = before.review!;
  assert.ok(review.openCount > 0);
  assert.ok(before.reviewMonths.includes('2026-09'));
  assert.ok(before.reviewMonths.includes('2026-10'));
  const eligible = [...review.employerChecks, ...review.personalChecks].filter(check => check.status === 'review');
  assert.ok(eligible.length > 0);
  for (const check of eligible) db.setReviewAcknowledgement(review.reportKey, check.key, true);
  const after = db.getReviewData('2026-09');
  assert.equal(after.review!.openCount, 0);
  assert.ok(!after.reviewMonths.includes('2026-09'));
  assert.ok(after.reviewMonths.includes('2026-10'));
  assert.equal(after.reviewMonths.length, before.reviewMonths.length - 1);
  const first = db
    .getReviewAcknowledgements()
    .find(value => value.reportKey === review.reportKey && value.checkKey === eligible[0].key)!;
  db.setReviewAcknowledgement(review.reportKey, eligible[0].key, true);
  assert.deepEqual(
    db
      .getReviewAcknowledgements()
      .find(value => value.reportKey === first.reportKey && value.checkKey === first.checkKey),
    first,
    'repeated acknowledgement preserves its original timestamp'
  );
  const persisted = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import{DatabaseSync}from'node:sqlite';import{resolve}from'node:path';const d=new DatabaseSync(resolve(process.env.DATA_DIR,'zeitklar.sqlite'));console.log(JSON.stringify(d.prepare('SELECT reportKey,checkKey,acknowledgedAt FROM review_acknowledgements WHERE reportKey=? AND checkKey=?').get(process.argv[1],process.argv[2])));d.close()",
      first.reportKey,
      first.checkKey
    ],
    { env: process.env, encoding: 'utf8' }
  );
  assert.deepEqual(
    JSON.parse(persisted.trim()),
    first,
    'independent database connection reloads exact timestamp and IDs'
  );
  assert.equal(db.exportData().acknowledgements.length, eligible.length);
  db.setReviewAcknowledgement(review.reportKey, eligible[0].key, false);
  assert.equal(db.getReviewData('2026-09').review!.openCount, 1);
  assert.ok(db.getReviewData('2026-09').reviewMonths.includes('2026-09'));
  db.saveReport({ ...report, printedAt: '2026-10-07' });
  assert.throws(() => db.setReviewAcknowledgement(review.reportKey, eligible[1].key, true), /veraltet/);
  assert.ok(
    db.getReviewData('2026-09').review!.openCount > 0,
    'older version acknowledgements do not close replacement report'
  );
  const replacement = db.getReviewData('2026-09').review!;
  for (const check of [...replacement.employerChecks, ...replacement.personalChecks].filter(
    check => check.status === 'review'
  ))
    db.setReviewAcknowledgement(replacement.reportKey, check.key, true);
  assert.ok(
    !db.getReviewData('2026-09').reviewMonths.includes('2026-09'),
    'older open version does not count after newest version is completely reviewed'
  );
  const july = db.getReviewData('2026-07').review!;
  const okay = july.employerChecks.find(check => check.status === 'ok')!;
  assert.ok(okay);
  assert.throws(() => db.setReviewAcknowledgement(july.reportKey, okay.key, true), /nicht quittiert/);
  const source = db.getReport('2026-07')!;
  db.saveReport({
    ...source,
    printedAt: '2026-10-08',
    days: source.days.map((day, index) => (index ? day : { ...day, actualHours: day.actualHours! + 1 }))
  });
  const changed = db.getReviewData('2026-07').review!,
    difference = changed.employerChecks.find(check => check.status === 'difference')!;
  assert.ok(difference);
  assert.throws(() => db.setReviewAcknowledgement(changed.reportKey, difference.key, true), /nicht quittiert/);
  assert.ok(db.getReviewData('2026-07').reviewMonths.includes('2026-07'));
  assert.throws(() => db.setReviewAcknowledgement('arbitrary', 'arbitrary', true));
});

test('SQLite global open-month badge counts queued generic/report uploads once per month', () => {
  const source = validateReport(parseText(julyText).report!);
  db.savePendingReport({
    ...source,
    period: '2027-01',
    days: source.days.map(day => ({ ...day, date: day.date.replace('2026-07', '2027-01') }))
  });
  db.savePendingEntryImport(parseText('03.01.2027;07:00;16:00;30', 'january.txt'));
  const january = db.getReviewData('2026-07').reviewMonths.filter(month => month === '2027-01');
  assert.equal(january.length, 1);
});

test('legacy saved zero opening remains an entered value on database reads and export', () => {
  const legacy = { ...emptySettlement('2027-01'), openingHours: 0 };
  delete legacy.openingHoursEntered;
  // Stored by a pre-v2 version of the app.
  db.mutateSync(s => {
    s.settlements.push(legacy);
    s.schemaVersion = 1;
  });
  assert.equal(db.getSettlement('2027-01').openingHoursEntered, true);
  assert.equal(db.getSettlements().find(value => value.month === '2027-01')!.openingHoursEntered, true);
  assert.equal(db.exportData().settlements.find(value => value.month === '2027-01')!.openingHoursEntered, true);
  assert.equal(db.getSettlement('2027-02').openingHoursEntered, false, 'unsaved months remain distinguishable');
});

test('SQLite page carries own-time months and switches to the previous employer closing when available', () => {
  db.saveRules({
    ...defaultRules,
    tariff: false,
    federalState: 'BY',
    dailyHours: [0, 0, 0, 0, 0, 0, 0],
    openingMonth: '2029-08',
    openingHours: 20,
    openingHoursEntered: true
  });
  db.saveSettlement({ ...emptySettlement('2029-08'), adjustmentHours: 1.25 });
  db.saveEntries(
    ['2029-08-03', '2029-09-03'].map(date =>
      validateEntry({ date, start: '08:00', end: '16:00', breakMinutes: 0, kind: 'work', note: '' })
    ),
    'Carry test'
  );
  const personal = db.getReviewData('2029-09');
  assert.equal(personal.report, null);
  assert.equal(personal.settlement.openingHours, 29.25);
  assert.equal(personal.settlement.openingHoursOrigin, 'personal');
  assert.ok(
    Math.abs(calculate(personal.entries, personal.rules, personal.month, personal.settlement).balance - 37.25) < 1e-8
  );
  db.saveReport({
    period: '2029-08',
    printedAt: '2029-10-12',
    filename: 'August.txt',
    days: [],
    totals: { closingBalance: 41.5 },
    wageTypes: {},
    issues: [],
    transfers: [],
    warnings: [],
    rawText: ''
  });
  const official = db.getReviewData('2029-09');
  assert.equal(official.settlement.openingHours, 41.5);
  assert.equal(official.settlement.openingHoursOrigin, 'previous');
  assert.equal(official.settlement.openingHoursGap, undefined);
});
