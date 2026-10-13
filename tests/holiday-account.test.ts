import { julyText } from './helpers/synthetic-dpl.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { holidayAccountCheck } from '../src/lib/holiday-account';
import { auditReport } from '../src/lib/audit';
import { defaultRules, emptySettlement } from '../src/lib/model';
import { getReportReview } from '../src/lib/review';
import { parseText } from '../src/lib/importer';
import type { ReportDay, TimeReport } from '../src/lib/report';

const rules = { ...defaultRules, confirmed: true, federalState: 'NW' };
const day = (date: string, hours: number, label = 'Do'): ReportDay => ({
  date,
  label,
  plannedHours: 8,
  actualHours: hours,
  holidayHours: hours,
  overtimeHours: null,
  standbyHours: null,
  standbyWeightedHours: null,
  standbyCount: null,
  nightHours: null,
  saturdayHours: null,
  sundayHours: null,
  spans: [],
  rawLines: []
});
const report = (period: string, balance: number): TimeReport => ({
  period,
  printedAt: period + '-28',
  filename: 'Test.txt',
  days: [],
  totals: { holidayBalance: balance, holidayTimeOffHours: 0, holidayPaidHours: 0 },
  wageTypes: { holiday35: 0, holiday135: 0 },
  issues: [],
  transfers: [],
  warnings: [],
  rawText: ''
});
const may = () => ({
  ...report('2026-05', 11.5),
  days: [day('2026-05-14', 11.5)],
  wageTypes: { holiday35: 11.5, holiday135: 0 }
});

test('May 14 with 11.50 regular holiday hours and FT35 creates an 11.50 hour credit', () => {
  const current = may(),
    prior = report('2026-04', 0);
  const check = holidayAccountCheck(current, rules, [prior, current])!;
  assert.equal(check.expected, 11.5);
  assert.equal(check.reported, 11.5);
  assert.equal(check.status, 'ok');
  assert.match(check.detail, /0,00 \+ 11,50 − 0,00 − 0,00 = 11,50 h/);
  assert.match(check.detail, /2026-05-14: 11,50 h/);
  assert.match(check.detail, /Anfangsstand aus 2026-04/);
  const audit = auditReport(current, rules, emptySettlement('2026-05'), [prior, current]);
  assert.equal(audit.checks.find(c => c.title === check.title)!.expected, 11.5);
  assert.equal(
    audit.payLines.find(l => l.label === 'Feiertag mit Freizeitausgleich')!.hours,
    11.5,
    'the monetary supplement uses the same source hours independently'
  );
});

test('FT135 pays holiday hours without adding them to the time account', () => {
  const current = {
    ...may(),
    totals: { ...may().totals, holidayBalance: 4 },
    wageTypes: { holiday35: 0, holiday135: 11.5 }
  };
  const check = holidayAccountCheck(current, rules, [report('2026-04', 4)])!;
  assert.equal(check.expected, 4);
  assert.equal(check.status, 'ok');
  assert.match(check.detail, /erzeugen keinen zusätzlichen Zeitkonto-Zugang/);
});

test('opening credit taken FT time and paid old hours are reconciled; BD FZA does not debit this account', () => {
  const current = may();
  current.days.push({ ...day('2026-05-20', 8, 'FT-FZA'), holidayHours: null });
  current.days.push({ ...day('2026-05-21', 8, 'BD-St.II-FZA.TVÄ'), holidayHours: null });
  current.totals = { holidayBalance: 10, holidayTimeOffHours: 8, holidayPaidHours: -5 };
  const check = holidayAccountCheck(current, rules, [report('2026-04', 11.5)])!;
  assert.equal(check.expected, 10);
  assert.equal(check.status, 'ok');
  assert.match(check.detail, /11,50 \+ 11,50 − 8,00 − 5,00 = 10,00 h/);
  current.totals.holidayBalance = 12;
  assert.equal(holidayAccountCheck(current, rules, [report('2026-04', 11.5)])!.status, 'difference');
});

test('older stored statements read movement fields from raw DPL text and blank account opening means zero', () => {
  const prior = report('2026-04', 0);
  prior.totals = { holidayBalance: null };
  prior.rawText = 'Freizeitkonto Feiertagsarb          \n';
  const current = may();
  current.totals = { holidayBalance: 11.5 };
  current.rawText = 'TV-Ä/TV-N:Freizeitausgl.FT       \nAbzgl.bez.FT-Std. Monat-4       \n';
  const check = holidayAccountCheck(current, rules, [prior])!;
  assert.equal(check.expected, 11.5);
  assert.equal(check.status, 'ok');
  assert.match(check.detail, /leeres Kontofeld als 0 h/);
  const july = parseText(julyText).report!;
  const june = report('2026-06', 0);
  const carried = holidayAccountCheck(july, rules, [june])!;
  assert.equal(carried.expected, 0);
  assert.equal(carried.status, 'ok');
});

test('missing previous account leaves an explicit tentative calculation instead of certifying a starting balance', () => {
  const check = holidayAccountCheck(may(), rules)!;
  assert.equal(check.expected, 11.5);
  assert.equal(check.status, 'review');
  assert.match(check.detail, /2026-04 fehlt; Anfangsstand vorläufig 0,00/);
});

test('December 24/31 supplement hours do not create holiday time account credit', () => {
  const current = {
    ...report('2026-12', 0),
    days: [day('2026-12-24', 8, 'Hlgbnd')],
    wageTypes: { holiday35: 8, holiday135: 0 }
  };
  const check = holidayAccountCheck(current, rules, [report('2026-11', 0)])!;
  assert.equal(check.expected, 0);
  assert.equal(check.status, 'ok');
  assert.match(check.detail, /nicht zum Freizeitkonto/);
});

test('changed April balance invalidates the May account acknowledgement without changing unrelated checks', () => {
  const current = may(),
    previous = report('2026-04', 0);
  const incomplete = getReportReview(current, rules, [], emptySettlement('2026-05'));
  const check = incomplete.employerChecks.find(c => c.title === 'Freizeitkonto Feiertagsarbeit')!;
  const receipt = { reportKey: incomplete.reportKey, checkKey: check.key, acknowledgedAt: new Date().toISOString() };
  const changed = getReportReview(current, rules, [], emptySettlement('2026-05'), [receipt], null, [
    { ...previous, totals: { ...previous.totals, holidayBalance: 2 } }
  ]);
  const account = changed.employerChecks.find(c => c.title === check.title)!;
  assert.equal(account.expected, 13.5);
  assert.equal(account.status, 'difference');
  assert.equal(account.acknowledgedAt, null);
  assert.notEqual(account.key, check.key);
  assert.equal(changed.employerChecks[0].key, incomplete.employerChecks[0].key);
});
