import { julyText, decemberText } from './helpers/synthetic-dpl.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticSickPay, automaticVacationPay, compensationTotal } from '../src/lib/sickness';
import { auditReport } from '../src/lib/audit';
import { isSickReportDay } from '../src/lib/absence';
import { calculate, percentageRate } from '../src/lib/calculate';
import { tariffProfile } from '../src/lib/tariff';
import { parseText } from '../src/lib/importer';
import { reportSignature } from '../src/lib/report-signature';
import { defaultRules, emptySettlement, validateEntry, type Entry } from '../src/lib/model';
import { getReportReview, getReviewMonths, reviewCheckKey } from '../src/lib/review';
import type { TimeReport } from '../src/lib/report';

const rules = {
  ...defaultRules,
  tariff: false,
  confirmed: true,
  federalState: 'NW',
  rateMode: 'manual' as const,
  hourlyRate: 100,
  individualRate: 100,
  overtimeBaseRate: 100
};
const report = (period: string, night: number): TimeReport => ({
  period,
  printedAt: period + '-28',
  filename: period + '.txt',
  days: [],
  totals: {},
  wageTypes: { night, saturday: null, sunday: null, holiday35: null, holiday135: null },
  transfers: [],
  issues: [],
  warnings: [],
  rawText: ''
});
const references = [report('2025-11', 20), report('2025-12', 20), report('2026-01', 25)];
function example(): TimeReport {
  const header = julyText.split(/\r?\n/).find(l => l.includes('Tg Text'))!;
  const row = (label: string, clock: string, credited: boolean) => {
    let s = ' '.repeat(131);
    const put = (offset: number, v: string) => {
      s = s.slice(0, offset) + v + s.slice(offset + v.length);
    };
    put(0, label);
    put(31, clock);
    if (credited) {
      put(47, '8,00');
      put(54, '8,00');
    }
    return s;
  };
  return parseText(
    [
      'Zeitnachweisliste',
      'Abr.periode : 01.02.2026 - 28.02.2026',
      'gedruckt_am : 30.04.2026',
      'Einzelergebnisse',
      header,
      row('16 Krankheit ohne A', '00:00 00:00', false),
      row('17 Di', '07:30 16:00', true),
      row('   Krankheit ohne A', '07:30 16:00', false),
      'Summenübersicht',
      'Istzeit 158,25',
      'vertragl.monatl.Sollzeit 160,00',
      'geplante Sollzeit 163,50'
    ].join('\n'),
    'sick-fza-february.txt'
  ).report!;
}
const sick = (date: string, meta: Entry['meta'] = {}): Entry => ({
  date,
  start: '',
  end: '',
  breakMinutes: 0,
  kind: 'sick',
  note: '',
  meta
});

test('June sickness uses March through May unchanged and yields the same 8.04 daily rate as vacation', () => {
  const profile = { ...defaultRules, confirmed: true, federalState: 'NW' };
  const amounts: [string, number][] = [
    ['2026-03', 44.38],
    ['2026-04', 167.71],
    ['2026-05', 310.67]
  ];
  const prior = amounts.map(([month, amount]) =>
    report(month, amount / percentageRate(tariffProfile(profile, month).bonusRate!, 20))
  );
  const illness = automaticSickPay([sick('2026-06-19')], prior, profile, '2026-06')!;
  const leave = automaticVacationPay([{ ...sick('2026-06-19'), kind: 'vacation' }], prior, profile, '2026-06')!;
  assert.deepEqual(illness.lines[0].months, ['2026-03', '2026-04', '2026-05']);
  assert.equal(illness.lines[0].sum, 522.76);
  assert.equal(illness.lines[0].dailyRate, 8.04);
  assert.equal(illness.amount, 8.04);
  assert.equal(illness.lines[0].dailyRate, leave.lines[0].dailyRate);
  assert.match(illness.lines[0].detail, /44,38/);
  assert.doesNotMatch(illness.lines[0].detail, /45,56|mit 90 %/);
  assert.equal(illness.checks.find(check => check.title.startsWith('Auszahlung:'))?.expected, 8.04);
  const previous = { ...illness.checks[1], expected: 8.06, detail: illness.checks[1].detail.replace('44,38', '45,56') };
  assert.notEqual(
    reviewCheckKey('employer', illness.checks[1]),
    reviewCheckKey('employer', previous),
    'a previous payment review must reopen when the calculation changes'
  );
});

test('the pictured Monday FZA and Tuesday illness are read from DPL including continuation rows', () => {
  const feb = example();
  assert.equal(feb.days[0].actualHours, null);
  assert.equal(feb.days[1].actualHours, 8);
  assert.equal(isSickReportDay(feb.days[1]), true);
  const result = automaticSickPay([], [...references, feb], rules, '2026-02')!;
  assert.equal(result.count, 1);
  assert.equal(result.lines[0].dailyRate, 20);
  assert.equal(result.amount, 20);
  assert.deepEqual(result.lines[0].dates, ['2026-02-17']);
  assert.deepEqual(result.lines[0].excluded, ['2026-02-16']);
  assert.match(result.checks[1].detail, /1 × 20,00/);
  assert.match(result.checks[0].detail, /2026-02-16/);
  const review = getReportReview(feb, rules, [], emptySettlement('2026-02'), [], result);
  assert.equal(review.employerChecks.filter(c => c.title === 'Krankheitstage').length, 1);
  assert.equal(review.employerChecks.filter(c => c.title === 'Auszahlung: Entgeltfortzahlung Krankheit').length, 1);
});
test('manual sick entries derive workdays automatically; a planned free override counts and credits zero', () => {
  const entries = [sick('2026-02-16', { sickPayEligible: false }), sick('2026-02-17')];
  const result = automaticSickPay(entries, references, rules, '2026-02')!;
  assert.equal(result.count, 1);
  assert.equal(result.amount, 20);
  assert.equal(calculate(entries, rules, '2026-02', emptySettlement('2026-02')).credited, 8);
  const preview = parseText('2026-02-16;Krankheit FZA\n2026-02-17;Krank');
  assert.equal(preview.entries[0].meta?.sickPayEligible, false);
  assert.equal(automaticSickPay(preview.entries, references, rules, '2026-02')!.count, 1);
  assert.throws(() => validateEntry({ ...entries[0], meta: { sickPayEligible: 'yes' } }), /Ungültige/);
});
test('source and manual sick dates are counted once; explicit personal plan corrections take priority', () => {
  const feb = example();
  const result = automaticSickPay([sick('2026-02-16'), sick('2026-02-17')], [...references, feb], rules, '2026-02')!;
  assert.equal(result.count, 1);
  assert.equal(
    automaticSickPay([sick('2026-02-17', { sickPayEligible: false })], [...references, feb], rules, '2026-02')!.count,
    0
  );
  assert.equal(
    automaticSickPay([sick('2026-02-17', { sickPayEligible: false })], [...references, feb], rules, '2026-02')!.amount,
    0
  );
});
test('missing reference months remain visible instead of fabricating a zero day rate', () => {
  const result = automaticSickPay([sick('2026-02-17')], references.slice(1), rules, '2026-02')!;
  assert.equal(result.count, 1);
  assert.equal(result.lines[0].dailyRate, null);
  assert.equal(result.amount, null);
  assert.match(result.checks[1].detail, /2025-11: Nachweis oder eigene Einträge fehlen/);
});
test('fixed monthly allowances and non-scheduled overtime never enter the sickness day rate', () => {
  const inflated = references.map(r => ({
    ...r,
    wageTypes: { ...r.wageTypes, shiftAllowance: 10000, overtimeBase: 300, overtimeBonus: 200 }
  }));
  assert.equal(automaticSickPay([sick('2026-02-17')], inflated, rules, '2026-02')!.lines[0].dailyRate, 20);
});
test('own work entries can supply the three prior month amounts without employer reports', () => {
  const dates = ['2025-11-03', '2025-12-01', '2026-01-05'];
  const entries = dates.map(date => ({ ...sick(date), kind: 'work' as const, start: '20:00', end: '22:00' }));
  const result = automaticSickPay([...entries, sick('2026-02-17')], [], rules, '2026-02')!;
  assert.equal(result.lines[0].sum, 120);
  assert.equal(result.lines[0].dailyRate, 1.85);
  assert.equal(result.amount, 1.85);
});
test('manual weekends default to no work and an explicit planned service counts; holidays remain free', () => {
  assert.equal(automaticSickPay([sick('2026-02-15')], references, rules, '2026-02')!.count, 0);
  assert.equal(
    automaticSickPay([sick('2026-02-15', { sickPayEligible: true })], references, rules, '2026-02')!.count,
    1
  );
  assert.equal(automaticSickPay([sick('2026-05-01')], references, rules, '2026-05')!.count, 0);
});
test('continuing illness over a month boundary retains the original three reference months', () => {
  const prior = [report('2025-10', 20), report('2025-11', 20), report('2025-12', 25)];
  const entries = [sick('2026-01-30'), sick('2026-02-02')];
  const jan = automaticSickPay(entries, prior, rules, '2026-01')!,
    feb = automaticSickPay(entries, prior, rules, '2026-02')!;
  assert.deepEqual(jan.lines[0].months, feb.lines[0].months);
  assert.equal(feb.amount, 20);
});
test('changing a continuation sickness marker changes report identity and payment review keys', () => {
  const feb = example(),
    changed = structuredClone(feb);
  changed.days[1].rawLines = changed.days[1].rawLines.map(l => l.replace('Krankheit ohne A', 'Normaldienst'));
  changed.days[1].spans = changed.days[1].spans.map(s => ({
    ...s,
    label: s.label.replace('Krankheit ohne A', 'Normaldienst')
  }));
  assert.notEqual(reportSignature(feb), reportSignature(changed));
  assert.equal(automaticSickPay([], [...references, changed], rules, '2026-02')!.count, 0);
  const before = automaticSickPay([sick('2026-02-17')], references, rules, '2026-02')!;
  const context = getReportReview(null, rules, [], emptySettlement('2026-02'), [], before);
  const ack = {
    reportKey: context.reportKey,
    checkKey: context.employerChecks[1].key,
    acknowledgedAt: new Date().toISOString()
  };
  assert.equal(
    getReviewMonths({ reports: references, rules, entries: [sick('2026-02-17')], acknowledgements: [ack] }).includes(
      '2026-02'
    ),
    false
  );
  const increased = references.map(r => ({ ...r, wageTypes: { ...r.wageTypes, night: 100 } }));
  assert.equal(
    getReviewMonths({ reports: increased, rules, entries: [sick('2026-02-17')], acknowledgements: [ack] }).includes(
      '2026-02'
    ),
    true
  );
});

test('December counts exactly the two annotated days and adds sick pay to remuneration', () => {
  const december = parseText(decemberText).report!;
  const profile = { ...rules, hourlyRate: 33.8 };
  const prior = ['2025-09', '2025-10', '2025-11'].map(m => report(m, 0.32));
  const sickness = automaticSickPay([], [...prior, december], profile, '2025-12')!;
  assert.equal(sickness.count, 2);
  assert.deepEqual(sickness.lines[0].dates, ['2025-12-08', '2025-12-09']);
  assert.deepEqual(sickness.lines[0].months, ['2025-09', '2025-10', '2025-11']);
  assert.equal(sickness.lines[0].dailyRate, 0.1);
  assert.equal(sickness.amount, 0.2);
  const days = sickness.checks[0];
  assert.equal(days.unit, 'count');
  assert.equal(days.expected, 2);
  assert.equal(days.reported, 2);
  assert.doesNotMatch(days.detail, /€|Tagessatz|Referenztage/);
  assert.match(sickness.checks[1].detail, /2 × 0,10/);
  const audit = auditReport(december, profile, emptySettlement('2025-12'));
  assert.equal(audit.estimatedPay, 13.52);
  assert.equal(compensationTotal(audit, sickness), 13.72);
});

test('a month with only sick pay has a total; missing or ambiguous bases remain open', () => {
  const sickness = automaticSickPay([sick('2026-02-17')], references, rules, '2026-02')!;
  const feb = report('2026-02', 0);
  const audit = auditReport(feb, rules, emptySettlement('2026-02'));
  assert.equal(compensationTotal(audit, sickness), 20);
  assert.equal(compensationTotal(null, sickness), 20);
  assert.equal(compensationTotal(audit, { ...sickness, amount: null }), null);
  assert.equal(
    compensationTotal(
      auditReport({ ...feb, wageTypes: { ...feb.wageTypes, holiday100: 8 } }, rules, emptySettlement('2026-02')),
      sickness
    ),
    null
  );
  assert.equal(
    compensationTotal(auditReport({ ...feb, wageTypes: {} }, rules, emptySettlement('2026-02')), sickness),
    null
  );
});

test('reference months use total night hours when both split fields are blank and avoid double counting', () => {
  const totalOnly = references.map(r => ({
    ...r,
    wageTypes: { ...r.wageTypes, night: null, nightStandby: null, nightTotal: r.wageTypes.night }
  }));
  assert.equal(automaticSickPay([sick('2026-02-17')], totalOnly, rules, '2026-02')!.amount, 20);
  const split = references.map(r => ({ ...r, wageTypes: { ...r.wageTypes, nightTotal: r.wageTypes.night } }));
  assert.equal(automaticSickPay([sick('2026-02-17')], split, rules, '2026-02')!.amount, 20);
});

test('December uses fixed 1/65 even with eleven absence days in the three prior months', () => {
  const december = parseText(decemberText).report!;
  const profile = { ...rules, hourlyRate: 33.8 };
  const entries = [
    ...[
      '2025-09-01',
      '2025-09-02',
      '2025-09-03',
      '2025-09-04',
      '2025-09-05',
      '2025-09-08',
      '2025-11-03',
      '2025-11-04'
    ].map(date => ({ ...sick(date), kind: 'vacation' as const })),
    ...['2025-10-06', '2025-10-07', '2025-10-08'].map(date => sick(date))
  ];
  const prior = [report('2025-09', 0), report('2025-10', 0), report('2025-11', 1)];
  // References with employer statements use the absences printed in those statements.
  const template = december.days[0];
  for (const r of prior)
    r.days = entries
      .filter(e => e.date.startsWith(r.period))
      .map(e => ({
        ...structuredClone(template),
        date: e.date,
        label: e.kind === 'vacation' ? 'Urlaub' : 'Krankheit',
        rawLines: [e.kind === 'vacation' ? 'Urlaub' : 'Krankheit'],
        spans: []
      }));
  const line = automaticSickPay([], [...prior, december], profile, '2025-12')!.lines[0];
  assert.equal(line.divisor, 65);
  assert.equal(line.dailyRate, 0.1);
  assert.equal(line.amount, 0.2);
  assert.match(line.detail, /fester Tages-Teiler 65 \(1\/65\)/);
  assert.match(line.detail, /6,76.*÷ 65 = 0,10/);
  assert.doesNotMatch(line.detail, /Ausfalltage abgezogen|65 −/);
  const noAbsences = prior.map(r => ({ ...r, days: [] }));
  const normal = automaticSickPay([], [...noAbsences, december], profile, '2025-12')!.lines[0];
  assert.equal(normal.divisor, 65);
  assert.equal(normal.dailyRate, 0.1);
  assert.equal(normal.amount, 0.2);
  assert.match(normal.detail, /fester Tages-Teiler 65/);
});

test('reference absence markers never change the fixed divisor', () => {
  const template = example().days[1];
  const november = {
    ...report('2025-11', 20),
    days: [
      { ...template, date: '2025-11-03', label: 'Krankheit Urlaub', rawLines: ['Krankheit Urlaub'], spans: [] },
      { ...template, date: '2025-11-04', label: 'Urlaub FZA', rawLines: ['Urlaub FZA'], spans: [] }
    ]
  };
  const line = automaticSickPay([sick('2026-02-17')], [november, ...references.slice(1)], rules, '2026-02')!.lines[0];
  assert.equal(line.divisor, 65);
  assert.equal(line.amount, 20);
  assert.doesNotMatch(line.detail, /Ausfalltage abgezogen|65 −/);
});

test('saved reference absence counts and the weekly distribution do not override fixed 1/65', () => {
  const state = {
    references: ['2025-11', '2025-12', '2026-01'].map((month, i) => ({
      month,
      amounts: { timeBonus: i === 2 ? 6.76 : 0, standby: 0, oncall: 0, plannedOvertime: 0, other: 0 },
      excludedAmount: 0,
      excludedDays: i === 0 ? 11 : 0,
      source: 'Test',
      sourceKey: '',
      confirmed: true
    })),
    periods: [],
    acknowledgements: {}
  };
  const line = automaticSickPay(
    [sick('2026-02-17')],
    references,
    { ...rules, dailyHours: [0, 8, 8, 8, 8, 0, 0] },
    '2026-02',
    state
  )!.lines[0];
  assert.equal(line.divisor, 65);
  assert.equal(line.dailyRate, 0.1);
  assert.equal(line.amount, 0.1);
  assert.doesNotMatch(line.detail, /Ausfalltage abgezogen/);
});
