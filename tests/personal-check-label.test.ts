import assert from 'node:assert/strict';
import test from 'node:test';
import { personalCheckLabel } from '../src/lib/personal-check-label';
import { comparePersonalEntries } from '../src/lib/audit';
import { reportReviewKey, reviewCheckKey, getReportReview } from '../src/lib/review';
import { defaultRules, emptySettlement, type Entry } from '../src/lib/model';
import type { ReportDay, TimeReport } from '../src/lib/report';

const entry = (overrides: Partial<Entry> = {}): Entry => ({
  date: '2026-07-01',
  kind: 'work',
  start: '16:00',
  end: '21:00',
  breakMinutes: 0,
  note: '',
  ...overrides
});
const day = (overrides: Partial<ReportDay> = {}): ReportDay => ({
  date: '2026-07-01',
  label: '',
  actualHours: 6.25,
  plannedHours: null,
  overtimeHours: null,
  standbyHours: null,
  standbyWeightedHours: null,
  standbyCount: null,
  nightHours: null,
  saturdayHours: null,
  sundayHours: null,
  holidayHours: null,
  spans: [],
  rawLines: [],
  ...overrides
});
const report = (days: ReportDay[]): TimeReport => ({
  period: '2026-07',
  printedAt: '',
  filename: '',
  days,
  totals: {},
  wageTypes: {},
  issues: [],
  transfers: [],
  warnings: [],
  rawText: ''
});
const check = (date = '2026-07-01') => ({ title: `${date}: Eigene Arbeitszeit / Arbeitgeber-Ist` });

test('regular parts of an overnight configured BD keep the service label on both dates', () => {
  const meta = { dutyDate: '2026-07-01', dutyName: 'Nachtdienst' };
  const entries = [
    entry({ meta }),
    entry({ date: '2026-07-02', start: '02:00', end: '06:00', kind: 'standby', meta }),
    entry({ date: '2026-07-02', start: '06:00', end: '07:15', meta })
  ];
  assert.equal(personalCheckLabel(check(), entries, null), '2026-07-01: Bereitschaftsdienst');
  assert.equal(personalCheckLabel(check('2026-07-02'), entries, null), '2026-07-02: Bereitschaftsdienst');
});

test('report BD quantities or labelled spans identify BD without personal standby phases', () => {
  for (const sourceDay of [
    day({ standbyHours: 4 }),
    day({ label: 'BD-St.II-FZA.TVÄ' }),
    day({ spans: [{ start: '21:00', end: '06:00', label: 'BD', kind: 'standby', raw: '' }] })
  ]) {
    assert.equal(personalCheckLabel(check(), [entry()], report([sourceDay])), '2026-07-01: Bereitschaftsdienst');
  }
});

test('regular and on-call work keep their actual type instead of becoming BD', () => {
  assert.equal(personalCheckLabel(check(), [entry()], null), '2026-07-01: Regeldienst');
  assert.equal(
    personalCheckLabel(check(), [entry(), entry({ kind: 'oncall' })], report([day({ label: 'Rufbereitschaft' })])),
    '2026-07-01: Rufbereitschaft'
  );
  assert.equal(personalCheckLabel(check(), [entry(), entry({ kind: 'callout' })], null), '2026-07-01: Ruf-Einsatz');
  assert.equal(personalCheckLabel({ title: 'Unbekannte Prüfung' }, [], null), 'Unbekannte Prüfung');
});

test('service grouping requires the same origin date and name', () => {
  const entries = [
    entry({ meta: { dutyDate: '2026-07-01', dutyName: 'Regel' } }),
    entry({ kind: 'standby', date: '2026-07-02', meta: { dutyDate: '2026-07-01', dutyName: 'Andere Vorlage' } })
  ];
  assert.equal(personalCheckLabel(check(), entries, null), '2026-07-01: Regeldienst');
});

test('short labels preserve comparison quantities, status and persisted acknowledgement', () => {
  const source = report([day({ standbyHours: 4 })]),
    entries = [entry()];
  const original = comparePersonalEntries(source, entries)[0];
  const snapshot = structuredClone(original),
    key = reviewCheckKey('personal', original);
  assert.equal(personalCheckLabel(original, entries, source), '2026-07-01: Bereitschaftsdienst');
  assert.deepEqual(original, snapshot);
  const acknowledgedAt = '2026-10-12T10:00:00.000Z';
  const review = getReportReview(source, defaultRules, entries, emptySettlement('2026-07'), [
    { reportKey: reportReviewKey(source), checkKey: key, acknowledgedAt }
  ]);
  assert.equal(review.personalChecks[0].key, key);
  assert.equal(review.personalChecks[0].acknowledgedAt, acknowledgedAt);
  assert.equal(review.personalChecks[0].expected, 5);
  assert.equal(review.personalChecks[0].reported, 6.25);
});
