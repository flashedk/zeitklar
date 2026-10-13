import { decemberText } from './helpers/synthetic-dpl.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticSickPay, automaticVacationPay, automaticContinuedPay, compensationTotal } from '../src/lib/sickness';
import { auditReport } from '../src/lib/audit';
import { isVacationReportDay } from '../src/lib/absence';
import { parseText } from '../src/lib/importer';
import { calculate, percentageRate } from '../src/lib/calculate';
import { tariffProfile } from '../src/lib/tariff';
import { defaultRules, emptySettlement, validateEntry, type Entry } from '../src/lib/model';
import { getReportReview, getReviewMonths } from '../src/lib/review';
import { reportSignature } from '../src/lib/report-signature';
import type { TimeReport } from '../src/lib/report';

const rules = {
  ...defaultRules,
  tariff: false,
  confirmed: true,
  federalState: 'NW',
  rateMode: 'manual' as const,
  hourlyRate: 33.8,
  individualRate: 33.8,
  overtimeBaseRate: 33.8
};
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
const references = [report('2025-09', 0), report('2025-10', 0), report('2025-11', 1)];
const vacation = (date: string, meta: Entry['meta'] = {}): Entry => ({
  date,
  start: '',
  end: '',
  breakMinutes: 0,
  kind: 'vacation',
  note: '',
  meta
});
const december = () => parseText(decemberText, 'Dezember.txt').report!;

test('December has five vacation days and two sick days; both payroll positions enter the total separately', () => {
  const dec = december(),
    reports = [...references, dec];
  assert.equal(dec.days.filter(isVacationReportDay).length, 5);
  const pay = automaticContinuedPay([], reports, rules, '2025-12')!;
  const leave = pay.lines.find(l => l.kind === 'vacation')!;
  assert.equal(
    pay.lines.filter(l => l.kind === 'vacation').length,
    1,
    'both December blocks use the same reference basis'
  );
  assert.deepEqual(leave.dates, ['2025-12-15', '2025-12-16', '2025-12-17', '2025-12-22', '2025-12-23']);
  assert.equal(leave.count, 5);
  assert.equal(leave.divisor, 65);
  assert.equal(leave.dailyRate, 0.1);
  assert.equal(leave.amount, 0.5);
  assert.equal(pay.lines.find(l => l.kind === 'sick')!.amount, 0.2);
  assert.equal(pay.amount, 0.7);
  assert.equal(compensationTotal(auditReport(dec, rules, emptySettlement('2025-12')), pay), 14.22);
  const days = pay.checks.find(c => c.title === 'Urlaubstage')!;
  assert.equal(days.expected, 5);
  assert.equal(days.reported, 5);
  assert.equal(days.unit, 'count');
  assert.doesNotMatch(days.detail, /€|Tagessatz/);
  const payments = getReportReview(dec, rules, [], emptySettlement('2025-12'), [], pay).employerChecks.filter(c =>
    c.title.startsWith('Auszahlung: Entgeltfortzahlung')
  );
  assert.equal(payments.length, 2);
  assert.notEqual(payments[0].key, payments[1].key);
});

test('manual vacation counts workdays once, uses the same 1/65 rate and permits explicit plan corrections', () => {
  const entries = [
    vacation('2025-12-10'),
    vacation('2025-12-11', { vacationPayEligible: false }),
    vacation('2025-12-13'),
    vacation('2025-12-14', { vacationPayEligible: true })
  ];
  const pay = automaticVacationPay(entries, references, rules, '2025-12')!;
  assert.equal(pay.count, 2);
  assert.equal(pay.amount, 0.2);
  assert.equal(calculate(entries, rules, '2025-12', emptySettlement('2025-12')).credited, 8);
  assert.equal(automaticVacationPay([vacation('2025-12-25')], references, rules, '2025-12')!.count, 0);
  assert.throws(() => validateEntry({ ...entries[0], meta: { vacationPayEligible: 'true' } }), /Ungültige/);
  const both = automaticVacationPay([vacation('2025-12-15')], [...references, december()], rules, '2025-12')!;
  assert.equal(both.count, 5);
});

test('generic imports preserve FZA and unpaid vacation exclusions', () => {
  const entries = parseText('2025-12-10;Urlaub\n2025-12-11;Urlaub FZA\n2025-12-12;unbezahlter Urlaub').entries;
  assert.equal(entries[1].meta?.vacationPayEligible, false);
  assert.equal(entries[2].meta?.vacationPayEligible, false);
  assert.equal(automaticVacationPay(entries, references, rules, '2025-12')!.count, 1);
});

test('report vacation without hour credit is excluded and sickness during vacation is never paid twice', () => {
  const dec = december();
  dec.days.find(d => d.date === '2025-12-15')!.actualHours = null;
  dec.days.find(d => d.date === '2025-12-15')!.plannedHours = null;
  dec.days.find(d => d.date === '2025-12-16')!.rawLines.push('Krankheit');
  const pay = automaticContinuedPay([vacation('2025-12-16')], [...references, dec], rules, '2025-12')!;
  assert.equal(
    pay.lines.filter(l => l.kind === 'vacation').reduce((n, l) => n + l.count, 0),
    3
  );
  assert.equal(
    pay.lines.filter(l => l.kind === 'sick').reduce((n, l) => n + l.count, 0),
    3
  );
  assert.ok(!pay.lines.filter(l => l.kind === 'vacation').some(l => l.dates.includes('2025-12-16')));
  const unpaid = structuredClone(dec);
  unpaid.days.find(d => d.date === '2025-12-22')!.rawLines.push('unbezahlter Urlaub');
  assert.equal(automaticVacationPay([], [...references, unpaid], rules, '2025-12')!.count, 2);
});

test('all January vacation days use October through December, including leave started in December', () => {
  const entries = [vacation('2025-12-29'), vacation('2025-12-30'), vacation('2026-01-02'), vacation('2026-01-20')];
  const reports = [...references, report('2025-12', 2)];
  const pay = automaticVacationPay(entries, reports, { ...rules, holidays: ['2025-12-31'] }, '2026-01')!;
  assert.equal(pay.lines.length, 1);
  assert.deepEqual(pay.lines[0].months, ['2025-10', '2025-11', '2025-12']);
  assert.equal(pay.lines[0].dailyRate, 0.31);
  assert.equal(pay.lines[0].amount, 0.62);
});

test('Easter holidays and weekend do not split the March leave into a second April payment basis', () => {
  const entries = [
    '2026-03-18',
    '2026-03-19',
    '2026-03-20',
    '2026-03-23',
    '2026-03-24',
    '2026-03-25',
    '2026-03-26',
    '2026-03-27',
    '2026-03-30',
    '2026-03-31',
    '2026-04-01',
    '2026-04-02',
    '2026-04-07'
  ].map(date => vacation(date));
  const prior = [report('2025-12', 0), report('2026-01', 10), report('2026-02', 10), report('2026-03', 100)];
  const april = automaticVacationPay(entries, prior, rules, '2026-04')!;
  assert.equal(april.lines.length, 1);
  assert.equal(april.count, 3);
  assert.equal(april.lines[0].start, '2026-03-18');
  assert.deepEqual(april.lines[0].months, ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(april.lines[0].dates, ['2026-04-01', '2026-04-02', '2026-04-07']);
  assert.equal(april.lines[0].dailyRate, 12.48);
  assert.equal(april.amount, 37.44);
  assert.equal(april.checks.filter(c => c.title.startsWith('Auszahlung:')).length, 1);
});

test('separate April vacation blocks still share the same monthly reference basis', () => {
  const entries = ['2026-03-31', '2026-04-01', '2026-04-02', '2026-04-07'].map(date => vacation(date));
  const work: Entry = {
    date: '2026-04-04',
    start: '08:00',
    end: '16:00',
    kind: 'work',
    breakMinutes: 0,
    note: '',
    meta: {}
  };
  const prior = [report('2025-12', 0), report('2026-01', 10), report('2026-02', 10), report('2026-03', 100)];
  const personal = automaticVacationPay([...entries, work], prior, rules, '2026-04')!;
  assert.equal(personal.lines.length, 1);
  assert.equal(personal.count, 3);
  const template = december().days[0];
  const april = {
    ...report('2026-04', 0),
    days: [{ ...template, date: '2026-04-04', label: 'Sa', rawLines: ['Dienst'], spans: [] }]
  };
  const employer = automaticVacationPay(entries, [...prior, april], rules, '2026-04')!;
  assert.equal(employer.lines.length, 1);
  assert.equal(employer.count, 3);
});

test('an unrecorded scheduled workday between March and April leave prevents an automatic merge', () => {
  const entries = [vacation('2026-03-30'), vacation('2026-04-01')];
  const prior = [report('2025-12', 0), report('2026-01', 10), report('2026-02', 10), report('2026-03', 100)];
  assert.equal(automaticVacationPay(entries, prior, rules, '2026-04')!.lines[0].start, '2026-04-01');
});

test('the April payroll example yields 3.41 per vacation day and 10.23 total without an extra table adjustment', () => {
  const profile = { ...defaultRules, confirmed: true, federalState: 'NW' };
  const amounts: [string, number][] = [
    ['2025-12', 0],
    ['2026-01', 97.63],
    ['2026-02', 79.88],
    ['2026-03', 44.38]
  ];
  const prior = amounts.map(([month, amount]) =>
    report(month, amount / percentageRate(tariffProfile(profile, month).bonusRate!, 20))
  );
  const dates = ['2026-03-31', '2026-04-01', '2026-04-02', '2026-04-07'];
  const april = automaticVacationPay(
    dates.map(date => vacation(date)),
    prior,
    profile,
    '2026-04'
  )!;
  assert.equal(april.lines.length, 1);
  assert.equal(april.count, 3);
  assert.deepEqual(april.lines[0].months, ['2026-01', '2026-02', '2026-03']);
  assert.equal(april.lines[0].sum, 221.89);
  assert.equal(april.lines[0].dailyRate, 3.41);
  assert.equal(april.amount, 10.23);
  assert.doesNotMatch(april.lines[0].detail, /mit 90 %/);
  assert.match(april.lines[0].detail, /ohne zusätzliche Tabellenanpassung/);
  const march = automaticVacationPay(
    dates.map(date => vacation(date)),
    prior,
    profile,
    '2026-03'
  )!;
  assert.deepEqual(march.lines[0].months, ['2025-12', '2026-01', '2026-02']);
  assert.equal(march.lines[0].dailyRate, 2.73);
  const illness = automaticSickPay([{ ...vacation('2026-04-07'), kind: 'sick' }], prior, profile, '2026-04')!;
  assert.equal(illness.lines[0].sum, 221.89);
  assert.equal(illness.lines[0].dailyRate, 3.41);
  assert.doesNotMatch(illness.lines[0].detail, /mit 90 %/);
});

test('missing reference months leave vacation pay and the combined total open', () => {
  const pay = automaticContinuedPay([vacation('2025-12-10')], references.slice(1), rules, '2025-12')!;
  assert.equal(pay.count, 1);
  assert.equal(pay.amount, null);
  assert.equal(compensationTotal(null, pay), null);
  assert.match(
    pay.checks.find(c => c.title.startsWith('Auszahlung:'))!.detail,
    /2025-09: Nachweis oder eigene Einträge fehlen/
  );
});

test('vacation annotation changes report identity, payout checks survive reload and changed bases reopen them', () => {
  const before = december(),
    changed = structuredClone(before);
  changed.days.find(d => d.date === '2025-12-15')!.rawLines = changed.days
    .find(d => d.date === '2025-12-15')!
    .rawLines.map(l => l.replace('Urlaub', 'Arbeit'));
  changed.days.find(d => d.date === '2025-12-15')!.spans = changed.days
    .find(d => d.date === '2025-12-15')!
    .spans.map(s => ({ ...s, label: s.label.replace('Urlaub', 'Arbeit') }));
  assert.notEqual(reportSignature(before), reportSignature(changed));
  const entries = [vacation('2025-12-15')],
    pay = automaticContinuedPay(entries, references, rules, '2025-12')!;
  const review = getReportReview(null, rules, entries, emptySettlement('2025-12'), [], pay),
    check = review.employerChecks.find(c => c.title.startsWith('Auszahlung:'))!;
  const ack = { reportKey: review.reportKey, checkKey: check.key, acknowledgedAt: new Date().toISOString() };
  assert.ok(!getReviewMonths({ reports: references, entries, rules, acknowledgements: [ack] }).includes('2025-12'));
  assert.ok(
    getReviewMonths({
      reports: [...references.slice(0, 2), report('2025-11', 2)],
      entries,
      rules,
      acknowledgements: [ack]
    }).includes('2025-12')
  );
  // Adding vacation leaves the existing illness payment calculation and its review key unchanged.
  const reports = [...references, before],
    sick = automaticSickPay([], reports, rules, '2025-12')!;
  const combined = automaticContinuedPay([], reports, rules, '2025-12')!;
  assert.equal(combined.lines.find(l => l.kind === 'sick')!.basisKey, sick.lines[0].basisKey);
});
