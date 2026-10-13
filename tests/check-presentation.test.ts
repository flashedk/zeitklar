import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { auditReport } from '../src/lib/audit';
import { groupStandbyChecks } from '../src/lib/check-groups';
import { compactEmployerRows, presentEmployerCheck } from '../src/lib/check-presentation';
import { parseText } from '../src/lib/importer';
import { defaultRules, emptySettlement } from '../src/lib/model';
import { getReportReview, reviewCheckKey } from '../src/lib/review';
import type { AuditCheck, TimeReport } from '../src/lib/report';

const rules = {
  ...defaultRules,
  confirmed: true,
  federalState: 'BY',
  group: '2' as const,
  rateMode: 'manual' as const,
  individualRate: 50.88
};
const sample = () => parseText(readFileSync('tests/fixtures/dpl-july-2026.txt', 'utf8')).report!;
const prior = (): TimeReport => ({
  period: '2026-06',
  printedAt: '',
  filename: '',
  days: [],
  totals: { holidayBalance: 11.5 },
  wageTypes: {},
  transfers: [],
  issues: [],
  warnings: [],
  rawText: ''
});
function context(source = sample()) {
  const audit = auditReport(source, rules, emptySettlement(source.period), [prior(), source]);
  const review = getReportReview(source, rules, [], emptySettlement(source.period), [], null, [prior(), source]);
  const rows = groupStandbyChecks(review.employerChecks.filter(check => !check.title.startsWith('Auszahlung: ')));
  return { source, audit, review, rows, compact: compactEmployerRows(rows) };
}

test('successful duplicate night and payout results collapse without changing source checks or keys', () => {
  const { rows, review, compact } = context();
  const before = structuredClone(review.employerChecks);
  assert.ok(rows.some(row => row.check.title === 'Nachtstunden: regulär + BD'));
  assert.ok(rows.some(row => row.check.title.startsWith('BD-Auszahlung:')));
  assert.ok(!compact.some(row => row.check.title === 'Nachtstunden: regulär + BD'));
  assert.ok(!compact.some(row => row.check.title.startsWith('BD-Auszahlung:')));
  assert.ok(compact.some(row => row.check.title === 'BD zur Auszahlung'));
  assert.deepEqual(review.employerChecks, before);
});

test('night-component disagreements and missing quantities stay visible as distinct checks', () => {
  const source = sample();
  source.wageTypes.nightStandby = (source.wageTypes.nightStandby ?? 0) + 1;
  const changed = context(source).compact.find(row => row.check.title === 'Nachtstunden: regulär + BD')!;
  assert.equal(changed.check.status, 'difference');
  source.wageTypes.night = null;
  assert.equal(
    context(source).compact.find(row => row.check.title === 'Nachtstunden: regulär + BD')!.check.status,
    'review'
  );
});

test('payout account discrepancy is never hidden by a successful paid-BD group', () => {
  const source = sample();
  source.totals.bdFactoredBuild = 8;
  const result = context(source);
  const row = result.compact.find(row => row.check.title.startsWith('BD-Auszahlung:'))!;
  assert.equal(row.check.status, 'difference');
  assert.equal(presentEmployerCheck(row.check, result.audit.hoursSummary, source).title, 'BD-Kontoaufbau');
});

test('monthly headings and tooltip copy omit attendance disclaimer and redundant BD account prefixes', () => {
  const { audit, source, rows } = context();
  const ist = presentEmployerCheck(
    audit.checks.find(check => check.title.startsWith('Istzeit:'))!,
    audit.hoursSummary,
    source
  );
  assert.equal(ist.title, 'Istzeit: Monatssumme');
  assert.ok(!ist.info.includes('keine unabhängige Anwesenheitsberechnung'));
  assert.deepEqual(ist.facts, []);
  for (const row of rows.filter(row => row.children))
    for (const check of row.children!) {
      const view = presentEmployerCheck(check, audit.hoursSummary, source);
      assert.ok(!view.info.includes('Zugang zum Zeitkonto'));
      assert.ok(!view.info.includes('Zugang zum BD-Auszahlungskonto'));
      assert.ok(view.info.includes('BD-Dauer'));
    }
});

test('time account and month balance show numeric equations in the heading and explanatory math below', () => {
  const { audit, source } = context();
  const account = presentEmployerCheck(
    audit.checks.find(check => check.title.startsWith('Zeitkonto:'))!,
    audit.hoursSummary,
    source
  );
  assert.equal(account.title, 'Zeitkonto: 71,50 + 154,75 + 11,40 − 184,00 + 0,00 = 53,65 h');
  assert.equal(account.formula, 'Anfang + Ist + BD-FZA − Vertragssoll + Korrektur');
  assert.ok(account.facts.includes('BD-FZA-Zugang: 11,40 h'));
  assert.ok(account.facts.some(fact => fact.startsWith('2026-07-01:')));
  assert.ok(account.info.includes('Bezahlte BD'));
  assert.ok(!JSON.stringify(account).includes('zugrunde liegende Buchungen'));
  const delta = presentEmployerCheck(
    audit.checks.find(check => check.title.startsWith('Monatssaldo:'))!,
    audit.hoursSummary,
    source
  );
  assert.equal(delta.title, 'Monatssaldo: 154,75 − 184,00 = -29,25 h');
  assert.equal(delta.formula, 'Ist − Vertragssoll');
  assert.ok(delta.info.includes('kein tariflicher Überstundenanspruch'));
});

test('overtime uses the higher target and retains source assumptions without deleted boilerplate', () => {
  const { audit, source } = context();
  const view = presentEmployerCheck(
    audit.checks.find(check => check.title.startsWith('Überstundenbasis:'))!,
    audit.hoursSummary,
    source
  );
  assert.equal(view.title, 'Überstunden: 0,00 h');
  assert.ok(view.facts.includes('Geplantes Soll: 166,75 h'));
  assert.ok(view.facts.includes('Vertragssoll: 184,00 h'));
  assert.ok(view.facts.includes('Verwendete Sollzeit: 184,00 h'));
  assert.ok(view.info.includes('höheren Sollzeit'));
  assert.ok(!JSON.stringify(view).includes('Die vorhandene leere Lohnart'));
  source.totals.plannedTarget = 200;
  const changed = context(source);
  assert.ok(
    presentEmployerCheck(
      changed.audit.checks.find(check => check.title.startsWith('Überstundenbasis:'))!,
      changed.audit.hoursSummary,
      source
    ).facts.includes('Verwendete Sollzeit: 200,00 h')
  );
});

test('BD and holiday accounts split math from tooltip notes and drop requested redundant copy', () => {
  const { audit, source } = context();
  const bd = presentEmployerCheck(
    audit.checks.find(check => check.title === 'Faktorisiertes BD-Konto')!,
    audit.hoursSummary,
    source
  );
  assert.ok(bd.formula?.includes('7,84 h Aufbau − 0,00 h Abbau'));
  assert.equal(bd.info, 'Ein ausgewiesenes leeres Abbaufeld wird als 0 h behandelt.');
  assert.ok(!JSON.stringify(bd).includes('Vormonatsumbuchungen'));
  const holidayCheck = audit.checks.find(check => check.title === 'Freizeitkonto Feiertagsarbeit')!;
  const holiday = presentEmployerCheck(holidayCheck, audit.hoursSummary, source);
  assert.ok(holiday.facts.some(fact => fact.startsWith('11,50 + 0,00 − 0,00 − 0,00 = 11,50 h')));
  assert.ok(holiday.facts.some(fact => fact.startsWith('Anfangsstand aus 2026-06: 11,50 h')));
  assert.equal(holiday.info, 'FT-Zeitzuschläge in Euro werden separat in der Vergütung berechnet.');
  assert.ok(!holiday.facts.some(fact => fact.includes('Feiertags-Freizeitausgleich fehlt als Monatssumme')));
});

test('presentation metadata cannot invalidate persisted acknowledgement identities', () => {
  const { audit, source } = context();
  for (const check of audit.checks) {
    const { presentation, ...original } = check;
    assert.equal(reviewCheckKey('employer', check), reviewCheckKey('employer', original));
    const snapshot = structuredClone(check);
    presentEmployerCheck(check, audit.hoursSummary, source);
    assert.deepEqual(check, snapshot);
    assert.equal(
      reviewCheckKey('employer', { ...check, presentation: { title: 'Alternative display' } } as AuditCheck),
      reviewCheckKey('employer', check)
    );
  }
});
