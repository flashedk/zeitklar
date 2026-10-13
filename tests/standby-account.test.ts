import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseText } from '../src/lib/importer';
import { auditReport } from '../src/lib/audit';
import { standbyAccountChecks } from '../src/lib/standby-account';
import { standbyTimeCredit } from '../src/lib/standby-credit';
import { groupStandbyChecks } from '../src/lib/check-groups';
import { suggestReference } from '../src/lib/continued-pay';
import { defaultRules, emptySettlement } from '../src/lib/model';

const sample = () => parseText(readFileSync('tests/fixtures/dpl-july-2026.txt', 'utf8')).report!;
const rules = { ...defaultRules, group: '2' as const, rateMode: 'manual' as const, individualRate: 50.88 };

test('the July example separates 11.40 FZA hours and 7.84 payout hours and reconciles the payout account', () => {
  const source = sample(),
    original = structuredClone(source);
  assert.equal(standbyTimeCredit(source).hours, 11.4);
  assert.equal(standbyTimeCredit(source, 'paid').hours, 7.84);
  const audit = auditReport(source, rules, emptySettlement(source.period));
  const rows = groupStandbyChecks(audit.checks.map(check => ({ ...check, key: check.title, acknowledgedAt: null })));
  const fza = rows.find(row => row.check.title === 'BD mit Freizeitausgleich')!;
  const paid = rows.find(row => row.check.title === 'BD zur Auszahlung')!;
  assert.equal(fza.check.expected, 11.4);
  assert.equal(fza.check.reported, 11.4);
  assert.equal(fza.children?.length, 3);
  assert.equal(paid.check.expected, 7.84);
  assert.equal(paid.check.reported, 7.84);
  assert.equal(paid.children?.length, 1);
  const account = audit.checks.find(check => check.title === 'Faktorisiertes BD-Konto')!;
  assert.equal(account.expected, 7.84);
  assert.equal(account.reported, 7.84);
  assert.equal(account.status, 'ok');
  assert.equal(audit.checks.find(check => check.title.startsWith('BD-Auszahlung:'))?.status, 'ok');
  assert.deepEqual(source, original);
});

test('reported payout hours create one priced payment position and remain separate in continued-pay references', () => {
  const source = sample();
  const audit = auditReport(source, rules, emptySettlement(source.period));
  const payment = audit.payLines.find(line => line.label === 'Bereitschaftsdienst zur Auszahlung')!;
  assert.equal(payment.hours, 7.84);
  assert.equal(payment.rate, 50.88);
  assert.equal(payment.amount, 398.9);
  assert.equal(audit.hoursSummary.standbyCredit.hours, 11.4);
  assert.equal(
    audit.checks.find(check => check.title === 'Auszahlung: Bereitschaftsdienst zur Auszahlung')?.expected,
    398.9
  );
  const reference = suggestReference(source.period, [source], rules);
  assert.equal(reference.amounts.standby, 398.9);
  assert.equal(reference.amounts.timeBonus, 458.11, 'time bonuses exclude BD base pay and the 40 EUR fixed allowance');
});

test('payout account differences and missing source fields remain visible', () => {
  const source = sample();
  source.totals.bdFactoredBuild = 8;
  assert.equal(
    standbyAccountChecks(source).find(check => check.title.startsWith('BD-Auszahlung:'))?.status,
    'difference'
  );
  assert.equal(standbyAccountChecks(source).find(check => check.title === 'Faktorisiertes BD-Konto')?.expected, 8);
  delete source.totals.bdFactoredDecrease;
  assert.equal(standbyAccountChecks(source).find(check => check.title === 'Faktorisiertes BD-Konto')?.status, 'review');
});

test('BD payout transfers are removed from review checks while original bookings stay available', () => {
  const source = sample();
  source.transfers = [
    { date: '2026-07-20', label: 'Ausz. BD', hours: 3 },
    { date: '2026-07-31', label: 'ZBD0 Ausz. BD Stunden Vorm.', hours: 4.84 }
  ];
  const original = structuredClone(source);
  const checks = auditReport(source, rules, emptySettlement(source.period)).checks;
  assert.ok(!checks.some(check => check.title.startsWith('Umbuchung')));
  assert.ok(checks.some(check => check.title === 'Faktorisiertes BD-Konto'));
  assert.ok(checks.some(check => check.title === 'Auszahlung: Bereitschaftsdienst zur Auszahlung'));
  assert.deepEqual(source, original);
});
