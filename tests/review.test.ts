import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultRules, emptySettlement, type Entry } from '../src/lib/model';
import type { AuditCheck, ReportDay, TimeReport } from '../src/lib/report';
import {
  getReportReview,
  getReviewMonths,
  reportReviewKey,
  reviewCheckKey,
  validateAcknowledgement,
  type ReviewAcknowledgement
} from '../src/lib/review';

const rules = { ...defaultRules, federalState: 'NI', confirmed: true };
const timestamp = '2026-10-06T12:00:00.000Z';
function statement(period = '2026-07'): TimeReport {
  const day: ReportDay = {
    date: period + '-03',
    label: '',
    plannedHours: 8,
    actualHours: 8,
    overtimeHours: null,
    standbyHours: 0,
    standbyWeightedHours: null,
    standbyCount: 0,
    nightHours: 0,
    saturdayHours: 0,
    sundayHours: null,
    holidayHours: null,
    spans: [],
    rawLines: []
  };
  return {
    period,
    printedAt: '2026-09-30',
    filename: 'test.txt',
    days: [day],
    totals: {
      actualHours: 8,
      plannedTarget: 8,
      contractualTarget: 8,
      openingBalance: 8,
      closingBalance: 8,
      monthlyBalance: 0,
      bdHours: 0,
      bdCount: 0
    },
    wageTypes: { night: 0, nightStandby: 0, nightTotal: 0, saturday: 0 },
    issues: [],
    transfers: [],
    warnings: [],
    rawText: ''
  };
}
function acknowledge(report: TimeReport, entries: Entry[] = []): ReviewAcknowledgement[] {
  const context = getReportReview(report, rules, entries, emptySettlement(report.period), []);
  return [...context.employerChecks, ...context.personalChecks]
    .filter(check => check.status === 'review')
    .map(check => ({ reportKey: context.reportKey, checkKey: check.key, acknowledgedAt: timestamp }));
}
const entry = (overrides: Partial<Entry> = {}): Entry => ({
  date: '2026-07-03',
  start: '07:00',
  end: '16:00',
  breakMinutes: 60,
  kind: 'work',
  note: '',
  ...overrides
});

test('report content identity ignores PDF/TXT source formatting and property insertion order', () => {
  const txt = statement();
  const pdf = { ...structuredClone(txt), filename: 'same.pdf', rawText: 'different PDF line wrapping' };
  pdf.days[0].rawLines = ['other grid formatting'];
  pdf.totals = Object.fromEntries(Object.entries(pdf.totals).reverse());
  assert.equal(reportReviewKey(pdf), reportReviewKey(txt));
  assert.match(reportReviewKey(txt), /^r1_[0-9a-f]{32}$/);
  const changed = structuredClone(txt);
  changed.totals.actualHours = 9;
  assert.notEqual(reportReviewKey(changed), reportReviewKey(txt));
  assert.notEqual(reportReviewKey({ ...txt, printedAt: '2026-10-01' }), reportReviewKey(txt));
});

test('check identity separates sources and includes every material check field', () => {
  const check: AuditCheck = {
    title: 'Zuordnung',
    status: 'review',
    expected: 8,
    reported: null,
    unit: 'h',
    detail: 'Pausenlage fehlt.'
  };
  const key = reviewCheckKey('employer', check);
  assert.notEqual(key, reviewCheckKey('personal', check));
  const changes: Partial<AuditCheck>[] = [
    { title: 'Andere Zuordnung' },
    { status: 'difference' },
    { expected: 8.5 },
    { reported: 8 },
    { unit: 'count' },
    { detail: 'BD-Zuordnung fehlt.' }
  ];
  for (const change of changes) assert.notEqual(key, reviewCheckKey('employer', { ...check, ...change }));
  assert.equal(
    key,
    reviewCheckKey('employer', {
      detail: check.detail,
      unit: check.unit,
      reported: check.reported,
      expected: check.expected,
      status: check.status,
      title: check.title
    })
  );
});

test('review acknowledgement removes open hints, can be revoked, and retains original status', () => {
  const report = statement();
  const before = getReportReview(report, rules, [], emptySettlement(report.period), []);
  assert.ok(before.openCount > 0);
  const after = getReportReview(report, rules, [], emptySettlement(report.period), acknowledge(report));
  assert.equal(after.openCount, 0);
  assert.ok(after.employerChecks.filter(c => c.acknowledgedAt).every(c => c.status === 'review'));
  assert.equal(getReportReview(report, rules, [], emptySettlement(report.period), []).openCount, before.openCount);
});

test('differences cannot be turned into acknowledged review items', () => {
  const report = statement(),
    entries = [entry({ breakMinutes: 0 })];
  const context = getReportReview(report, rules, entries, emptySettlement(report.period), acknowledge(report));
  const difference = context.personalChecks.find(check => check.status === 'difference')!;
  const forged = { reportKey: context.reportKey, checkKey: difference.key, acknowledgedAt: timestamp };
  const after = getReportReview(report, rules, entries, emptySettlement(report.period), [
    ...acknowledge(report),
    forged
  ]);
  assert.equal(after.personalChecks[0].acknowledgedAt, null);
  assert.equal(after.openCount, 1);
});

test('new report versions invalidate acknowledgements even when the check title is unchanged', () => {
  const oldReport = statement(),
    acknowledgements = acknowledge(oldReport);
  const next = { ...structuredClone(oldReport), printedAt: '2026-10-01' };
  const context = getReportReview(next, rules, [], emptySettlement(next.period), acknowledgements);
  assert.ok(context.openCount > 0);
  assert.ok(context.employerChecks.every(check => check.acknowledgedAt === null));
});

test('a changed settlement invalidates the affected acknowledged check within the same report version', () => {
  const report = statement();
  report.totals.closingBalance = null;
  const settlement = { ...emptySettlement(report.period), adjustmentHours: 1 };
  const context = getReportReview(report, rules, [], settlement, []);
  const check = context.employerChecks.find(c => c.title.startsWith('Zeitkonto'))!;
  assert.equal(check.status, 'review');
  const ack = { reportKey: context.reportKey, checkKey: check.key, acknowledgedAt: timestamp };
  assert.equal(
    getReportReview(report, rules, [], settlement, [ack]).employerChecks.find(c => c.title.startsWith('Zeitkonto'))
      ?.acknowledgedAt,
    timestamp
  );
  const changed = getReportReview(report, rules, [], { ...settlement, adjustmentHours: 2 }, [ack]);
  assert.equal(changed.reportKey, context.reportKey);
  assert.equal(changed.employerChecks.find(c => c.title.startsWith('Zeitkonto'))?.acknowledgedAt, null);
});

test('global badge deduplicates months across pending imports and open latest reports', () => {
  const july = statement(),
    august = statement('2026-08');
  const pending = { id: 1, report: july, createdAt: timestamp };
  const generic = {
    id: 2,
    preview: { entries: [entry(), entry({ date: '2026-09-03' })], warnings: [], text: '', filename: 'mixed.txt' },
    createdAt: timestamp
  };
  const months = getReviewMonths({
    reports: [july, august],
    rules,
    entries: [entry({ date: '2026-12-03' })],
    settlements: [],
    acknowledgements: [],
    pendingReports: [pending, { ...pending, id: 3 }],
    pendingEntryImports: [generic]
  });
  assert.deepEqual(months, ['2026-09', '2026-08', '2026-07']);
});

test('latest insertion replaces older review state; acknowledged latest version can close its month', () => {
  const older = statement(),
    latest = { ...statement(), printedAt: '2026-10-01' };
  older.totals.actualHours = 9; // Old version has a difference but is no longer the current statement.
  const workspace = {
    reports: [older, latest],
    rules,
    entries: [],
    settlements: [],
    acknowledgements: acknowledge(latest),
    pendingReports: [],
    pendingEntryImports: []
  };
  assert.deepEqual(getReviewMonths(workspace), []);
  assert.deepEqual(getReviewMonths({ ...workspace, acknowledgements: [] }), ['2026-07']);
  assert.deepEqual(
    getReviewMonths({ ...workspace, reports: [latest, older] }),
    ['2026-07'],
    'insertion order, not printedAt, decides the current version'
  );
});

test('own entries without a report do not create badge months; pending generic imports do', () => {
  const workspace = {
    reports: [],
    rules,
    entries: [entry()],
    settlements: [],
    acknowledgements: [],
    pendingReports: [],
    pendingEntryImports: []
  };
  assert.deepEqual(getReviewMonths(workspace), []);
  assert.deepEqual(
    getReviewMonths({
      ...workspace,
      pendingEntryImports: [
        { id: 1, preview: { entries: [entry()], warnings: [], text: '', filename: 'own.txt' }, createdAt: timestamp }
      ]
    }),
    ['2026-07']
  );
});

test('acknowledgement validation rejects malformed keys and impossible timestamps', () => {
  const valid = acknowledge(statement())[0];
  assert.deepEqual(validateAcknowledgement(valid), valid);
  for (const value of [
    null,
    [],
    { ...valid, reportKey: 'other' },
    { ...valid, checkKey: 'c1_' + 'A'.repeat(32) },
    { ...valid, acknowledgedAt: '2026-02-30T12:00:00.000Z' },
    { ...valid, acknowledgedAt: '2026-10-06' }
  ])
    assert.throws(() => validateAcknowledgement(value));
});
