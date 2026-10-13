import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { standbyTimeCredit } from '../src/lib/standby-credit';
import { auditReport, getEmployerHours } from '../src/lib/audit';
import { parseText } from '../src/lib/importer';
import { resolveMonthSettlement } from '../src/lib/balance';
import { defaultRules, emptySettlement } from '../src/lib/model';

const sample = () => parseText(readFileSync('tests/fixtures/dpl-july-2026.txt', 'utf8')).report!;

test('DPL credits three 3.80 h FZA duties without adding the 7.84 h paid BD account', () => {
  const source = sample(),
    before = structuredClone(source);
  const credit = standbyTimeCredit(source);
  assert.equal(credit.hours, 11.4);
  assert.equal(credit.days.length, 3);
  assert.deepEqual(credit.unresolvedDates, []);
  assert.equal(source.totals.bdFactoredBuild, 7.84);
  const audit = auditReport(source, defaultRules, emptySettlement(source.period));
  const balance = audit.checks.find(check => check.title.startsWith('Zeitkonto'))!;
  assert.equal(balance.expected, 53.65);
  assert.equal(balance.reported, 53.65);
  assert.equal(balance.status, 'ok');
  assert.match(balance.title, /BD-FZA/);
  assert.match(balance.detail, /11,40 BD-FZA/);
  assert.deepEqual(source, before, 'original report values are unchanged');
});

test('the reported June example reaches 71.50 h with a visible 11.40 h FZA contribution', () => {
  const source = sample();
  source.period = '2026-06';
  source.days = source.days
    .filter(day => day.label.includes('FZA'))
    .map((day, index) => ({ ...day, date: `2026-06-${['16', '22', '30'][index]}` }));
  source.totals = {
    ...source.totals,
    openingBalance: 85.6,
    actualHours: 150.5,
    contractualTarget: 176,
    plannedTarget: 176,
    closingBalance: 71.5,
    monthlyBalance: -25.5
  };
  const audit = auditReport(source, defaultRules, emptySettlement(source.period));
  assert.equal(audit.hoursSummary.computedClosingBalance, 71.5);
  assert.equal(audit.checks.find(check => check.title.startsWith('Zeitkonto'))?.status, 'ok');
  assert.equal(audit.hoursSummary.monthlyDelta, -25.5);
  assert.equal(audit.hoursSummary.overtimeBasis, 0, 'BD credit must not become overtime');
  const correction = getEmployerHours(source, defaultRules, { ...emptySettlement(source.period), adjustmentHours: 2 });
  assert.equal(correction.computedClosingBalance, 73.5);
});

test('credit is derived from FZA source markers, not the closing-balance gap or all weighted BD hours', () => {
  const source = sample();
  source.days = source.days.map(day => ({
    ...day,
    label: day.label.replaceAll('FZA', 'bez'),
    rawLines: day.rawLines.map(line => line.replaceAll('FZA', 'bez')),
    spans: day.spans.map(span => ({
      ...span,
      label: span.label.replaceAll('FZA', 'bez'),
      raw: span.raw.replaceAll('FZA', 'bez')
    }))
  }));
  assert.equal(standbyTimeCredit(source).hours, 0);
  assert.equal(getEmployerHours(source, defaultRules, emptySettlement(source.period)).computedClosingBalance, 42.25);
  assert.equal(
    auditReport(source, defaultRules, emptySettlement(source.period)).checks.find(check =>
      check.title.startsWith('Zeitkonto')
    )?.status,
    'difference'
  );
});

test('missing weighted hours and mixed paid/FZA day totals remain open rather than being guessed', () => {
  const source = sample();
  const first = source.days.find(day => day.label.includes('FZA'))!;
  first.standbyWeightedHours = null;
  const credit = standbyTimeCredit(source);
  assert.equal(credit.hours, 7.6);
  assert.deepEqual(credit.unresolvedDates, [first.date]);
  assert.equal(
    auditReport(source, defaultRules, emptySettlement(source.period)).checks.find(check =>
      check.title.startsWith('Zeitkonto')
    )?.status,
    'review'
  );
  first.standbyWeightedHours = 11.64;
  first.rawLines.push('BD-St.II-bez.TVÄ');
  assert.equal(standbyTimeCredit(source).hours, 7.6, 'mixed daily totals cannot all be credited');
});

test('already stored reports retain source-based FZA allocation and calculated closing balances carry forward', () => {
  const prior = sample();
  prior.totals.closingBalance = null;
  const next = { ...sample(), period: '2026-08', days: [], totals: { actualHours: 160, contractualTarget: 160 } };
  const settlement = resolveMonthSettlement(defaultRules, next.period, [], [prior, next]);
  assert.equal(settlement.openingHours, 53.65);
  assert.equal(getEmployerHours(next, defaultRules, settlement).computedClosingBalance, 53.65);
  // Legacy parsed labels may be less precise; retained raw source still identifies the duty.
  for (const day of prior.days) {
    day.label = '';
    day.spans = [];
  }
  assert.equal(standbyTimeCredit(prior).hours, 11.4);
});
