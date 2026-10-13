import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { auditReport } from '../src/lib/audit';
import { parseText } from '../src/lib/importer';
import { defaultRules, emptySettlement } from '../src/lib/model';
import { presentPayLine } from '../src/lib/pay-presentation';
import { getReportReview, reviewCheckKey } from '../src/lib/review';

const source = () => parseText(readFileSync('tests/fixtures/dpl-july-2026.txt', 'utf8')).report!;
const rules = {
  ...defaultRules,
  confirmed: true,
  federalState: 'BY',
  group: '2' as const,
  rateMode: 'manual' as const,
  individualRate: 50.88
};

test('hourly pay keeps its quantity, rate and amount while the requested row explanations are removed', () => {
  const report = source(),
    audit = auditReport(report, rules, emptySettlement(report.period));
  const before = structuredClone(audit);
  for (const line of audit.payLines) {
    const view = presentPayLine(line);
    assert.ok(!view.basis.includes('keine Zahlungsbestätigung'));
    assert.ok(!view.basis.includes('Bereits faktorisierte Stunden ausschließlich'));
    assert.ok(!view.basis.includes('Anspruchsvoraussetzungen nicht unabhängig geprüft'));
  }
  const night = audit.payLines.find(line => line.label === 'Nachtarbeit regulär')!;
  assert.equal(presentPayLine(night).quantity, '28,75 h');
  assert.equal(night.amount, 292.68);
  const paid = audit.payLines.find(line => line.label === 'Bereitschaftsdienst zur Auszahlung')!;
  assert.equal(presentPayLine(paid).quantity, '7,84 h');
  assert.equal(paid.amount, 398.9);
  assert.deepEqual(audit, before);
});

test('shift allowance is one monthly quantity rather than an hour, including legacy pay lines', () => {
  const report = source(),
    audit = auditReport(report, rules, emptySettlement(report.period));
  const allowance = audit.payLines.find(line => line.label === 'Ausgewiesene Schicht-/Wechselschichtzulage')!;
  assert.equal(allowance.quantityUnit, 'count');
  assert.deepEqual(presentPayLine(allowance), { quantity: '1', basis: '' });
  assert.deepEqual(presentPayLine({ ...allowance, quantityUnit: undefined }), { quantity: '1', basis: '' });
  assert.equal(allowance.hours, 1);
  assert.equal(allowance.rate, 40);
  assert.equal(allowance.amount, 40);
});

test('cleaning remuneration display does not change existing payout identities or receipts', () => {
  const report = source(),
    settlement = emptySettlement(report.period);
  const audit = auditReport(report, rules, settlement);
  const review = getReportReview(report, rules, [], settlement);
  const allowance = review.employerChecks.find(
    check => check.title === 'Auszahlung: Ausgewiesene Schicht-/Wechselschichtzulage'
  )!;
  const key = reviewCheckKey('employer', allowance);
  const acknowledgedAt = '2026-10-12T10:00:00.000Z';
  audit.payLines.forEach(presentPayLine);
  const reloaded = getReportReview(report, rules, [], settlement, [
    { reportKey: review.reportKey, checkKey: key, acknowledgedAt }
  ]);
  const saved = reloaded.employerChecks.find(check => check.title === allowance.title)!;
  assert.equal(saved.key, key);
  assert.equal(saved.acknowledgedAt, acknowledgedAt);
  assert.equal(saved.expected, 40);
});
