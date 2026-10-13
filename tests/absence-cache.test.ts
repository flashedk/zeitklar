import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AbsenceCache, automaticContinuedPay } from '../src/lib/sickness';
import { emptySnapshot, latestReports, normalizeSnapshot, parseBackup, restoreBackup } from '../src/lib/workspace';

// Six years of the demo data: absences span many months and reference periods.
const snapshot = emptySnapshot();
restoreBackup(snapshot, parseBackup(readFileSync('docs/demo/zeitklar-demo.json', 'utf8')));
for (const { report } of [...snapshot.reports])
  for (let year = 1; year < 6; year++) {
    const shift = (value: string) => value.replace(/^2026/, String(2026 - year));
    snapshot.reports.unshift({
      report: {
        ...report,
        period: shift(report.period),
        days: report.days.map(day => ({ ...day, date: shift(day.date) }))
      },
      importedAt: ''
    });
  }
normalizeSnapshot(snapshot);
const reports = latestReports(snapshot);
const months = [...new Set(reports.map(report => report.period))].sort();

test('the absence cache returns exactly the uncached result for every month', () => {
  const cache = new AbsenceCache(snapshot.entries, reports, snapshot.rules, snapshot.continuedPay);
  let withPay = 0;
  for (const month of months) {
    const plain = automaticContinuedPay(snapshot.entries, reports, snapshot.rules, month, snapshot.continuedPay);
    const cached = automaticContinuedPay(
      snapshot.entries,
      reports,
      snapshot.rules,
      month,
      snapshot.continuedPay,
      cache
    );
    assert.deepEqual(cached, plain, month);
    if (plain) withPay++;
  }
  assert.ok(withPay > 10, 'the data set exercises sick and vacation pay');
});

test('a cache built for other inputs is ignored', () => {
  const month = months.find(m =>
    automaticContinuedPay(snapshot.entries, reports, snapshot.rules, m, snapshot.continuedPay)
  )!;
  const stale = new AbsenceCache([], [], snapshot.rules, snapshot.continuedPay);
  automaticContinuedPay([], [], snapshot.rules, month, snapshot.continuedPay, stale);
  assert.deepEqual(
    automaticContinuedPay(snapshot.entries, reports, snapshot.rules, month, snapshot.continuedPay, stale),
    automaticContinuedPay(snapshot.entries, reports, snapshot.rules, month, snapshot.continuedPay)
  );
});
