import assert from 'node:assert/strict';
import test from 'node:test';
import { auditReport, comparePersonalEntries, getEmployerHours } from '../src/lib/audit';
import { defaultRules, emptySettlement } from '../src/lib/model';
import type { ReportDay, TimeReport } from '../src/lib/report';
import { getReportReview, getReviewMonths, reviewCheckKey } from '../src/lib/review';

const day = (overrides: Partial<ReportDay>): ReportDay => ({
  date: '2026-07-01',
  label: 'BD-St.II-FZA.TVÄ',
  plannedHours: null,
  actualHours: null,
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
const report = (overrides: Partial<TimeReport> = {}): TimeReport => ({
  period: '2026-07',
  printedAt: '2026-09-30',
  filename: 'DPL.txt',
  days: [],
  totals: {},
  wageTypes: {},
  transfers: [],
  issues: [],
  warnings: [],
  rawText: '',
  ...overrides
});
const rules = {
  ...defaultRules,
  confirmed: true,
  group: '2' as const,
  individualRate: 50.88,
  rateMode: 'manual' as const
};

test('checks employer sums without treating them as independent attendance', () => {
  const audit = auditReport(
    report({
      days: [day({ actualHours: 8 }), day({ date: '2026-07-02', actualHours: 9 })],
      totals: { actualHours: 17 }
    }),
    rules,
    emptySettlement('2026-07')
  );
  assert.equal(audit.checks.find(c => c.title.startsWith('Istzeit'))?.status, 'ok');
  assert.ok(audit.warnings.some(s => s.includes('unabhängige Einträge')));
  assert.ok(
    !audit.checks.some(c => c.title.startsWith('Zahlung') || c.title.startsWith('Auszahlung')),
    'no global payment task without a priced wage position'
  );
});

test('balances expose sample 11.40 h reconciliation gap instead of inventing bookings', () => {
  const audit = auditReport(
    report({
      totals: {
        openingBalance: 71.5,
        actualHours: 154.75,
        contractualTarget: 184,
        closingBalance: 53.65,
        monthlyBalance: -29.25
      }
    }),
    rules,
    emptySettlement('2026-07')
  );
  const balance = audit.checks.find(c => c.title.startsWith('Zeitkonto'))!;
  assert.equal(balance.expected, 42.25);
  assert.equal(balance.reported, 53.65);
  assert.equal(balance.status, 'difference');
  assert.match(balance.detail, /11,40/);
  assert.equal(audit.checks.find(c => c.title.startsWith('Monatssaldo'))?.status, 'ok');
  const explicit = auditReport(
    report({ totals: { openingBalance: 71.5, actualHours: 154.75, contractualTarget: 184, closingBalance: 53.65 } }),
    rules,
    { ...emptySettlement('2026-07'), adjustmentHours: 11.4 }
  );
  assert.equal(explicit.checks.find(c => c.title.startsWith('Zeitkonto'))?.status, 'ok');
});

test('day BD level II validation allows cent-rounded 95% and keeps account total separate', () => {
  const audit = auditReport(
    report({
      days: [
        day({ standbyHours: 4, standbyWeightedHours: 3.8 }),
        day({ date: '2026-07-11', label: 'BD-St.II-bez.TVÄ', standbyHours: 8.25, standbyWeightedHours: 7.84 })
      ],
      totals: { bdHours: 12.25, bdFactoredTotal: 7.84 }
    }),
    rules,
    emptySettlement('2026-07')
  );
  const bd = audit.checks.filter(c => c.title.includes('BD-Grundbewertung'));
  assert.equal(bd.length, 2);
  assert.ok(bd.every(c => c.status === 'ok'));
  assert.equal(audit.checks.find(c => c.title === 'Faktorisiertes BD-Konto')?.status, 'review');
});

test('night split arithmetic and gross estimate use claimed quantities and service table', () => {
  const audit = auditReport(
    report({
      wageTypes: { night: 28.75, nightStandby: 16, nightTotal: 44.75, saturday: 0.25, shiftAllowance: 40 },
      days: [day({ nightHours: 44.75, saturdayHours: 0.25 })]
    }),
    rules,
    emptySettlement('2026-07')
  );
  assert.equal(audit.checks.find(c => c.title === 'Nachtstunden: regulär + BD')?.status, 'ok');
  assert.equal(audit.estimatedPay, 498.11);
  assert.ok(
    audit.payLines
      .filter(p => p.label.includes('Nacht'))
      .every(p => p.rate === 10.18 && p.basis.includes('Arbeitgeberstunden'))
  );
});

test('each priced wage position has its own payment review, independent of legacy global payout', () => {
  const source = report({ wageTypes: { night: 10, nightStandby: 2, saturday: 0.25, shiftAllowance: 40 } });
  const settlement = emptySettlement(source.period);
  const audit = auditReport(source, rules, settlement);
  const payments = audit.checks.filter(c => c.title.startsWith('Auszahlung: '));
  assert.equal(payments.length, audit.payLines.length);
  for (const [i, line] of audit.payLines.entries()) {
    const check = payments[i];
    assert.equal(check.title, `Auszahlung: ${line.label}`);
    assert.equal(check.expected, line.amount);
    assert.equal(check.reported, null);
    assert.equal(check.unit, 'EUR');
    assert.equal(check.status, 'review');
    assert.match(check.detail, /Leistungsmonat 2026-07/);
  }
  assert.match(payments[0].detail, /10,00 h × 10,18 EUR\/h = 101,80 EUR/);
  assert.match(payments.find(c => c.title.includes('Wechselschicht'))!.detail, /Monatszulage/);
  assert.ok(!audit.checks.some(c => c.title.startsWith('Zahlung')));
  for (const paidBonus of [0, 100, 101.8, 1000])
    assert.deepEqual(
      auditReport(source, rules, { ...settlement, paidBonus }),
      audit,
      'old global payout does not validate or change any individual position'
    );
  const unavailable = auditReport(report({ wageTypes: { holiday100: 10 } }), rules, settlement);
  assert.ok(
    !unavailable.checks.some(c => c.title.startsWith('Auszahlung:')),
    'unpriced positions never invent an expected payment'
  );
});

test('missing BD night wage counts as zero only when regular night hours are known', () => {
  for (const nightStandby of [undefined, null, 0]) {
    const source = report({
      wageTypes: { night: 10, nightTotal: 10, ...(nightStandby === undefined ? {} : { nightStandby }) }
    });
    const check = auditReport(source, rules, emptySettlement(source.period)).checks.find(
      c => c.title === 'Nachtstunden: regulär + BD'
    )!;
    assert.equal(check.expected, 10);
    assert.equal(check.reported, 10);
    assert.equal(check.status, 'ok');
    if (nightStandby !== 0) assert.match(check.detail, /nicht ausgewiesen.*0 h/);
  }
  const differing = auditReport(
    report({ wageTypes: { night: 10, nightTotal: 11 } }),
    rules,
    emptySettlement('2026-07')
  ).checks.find(c => c.title === 'Nachtstunden: regulär + BD')!;
  assert.equal(differing.status, 'difference');
  for (const wageTypes of [
    {},
    { nightStandby: 5, nightTotal: 5 },
    { night: null, nightStandby: null, nightTotal: 0 }
  ] as TimeReport['wageTypes'][]) {
    const check = auditReport(report({ wageTypes }), rules, emptySettlement('2026-07')).checks.find(
      c => c.title === 'Nachtstunden: regulär + BD'
    )!;
    assert.equal(check.expected, null);
    assert.equal(check.status, 'review');
  }
  const explicitZero = auditReport(
    report({ wageTypes: { night: 0, nightTotal: 0 } }),
    rules,
    emptySettlement('2026-07')
  ).checks.find(c => c.title === 'Nachtstunden: regulär + BD')!;
  assert.equal(explicitZero.expected, 0);
  assert.equal(explicitZero.status, 'ok');
});

test('payment acknowledgement identity includes hours rate and service month even for equal amounts', () => {
  const source = report({ wageTypes: { night: 10 } });
  const payment = (input = source, profile = rules) =>
    auditReport(input, profile, emptySettlement(input.period)).checks.find(
      c => c.title === 'Auszahlung: Nachtarbeit regulär'
    )!;
  const original = payment();
  const identical = payment({ ...source, filename: 'same.pdf', rawText: 'different source formatting' });
  assert.equal(reviewCheckKey('employer', original), reviewCheckKey('employer', identical));
  const differentBasis = payment(report({ wageTypes: { night: 20 } }), {
    ...rules,
    tariff: false,
    hourlyRate: 25.45,
    nightPercent: 20
  });
  assert.equal(differentBasis.expected, original.expected, '20×5.09 equals10×10.18');
  assert.notEqual(reviewCheckKey('employer', differentBasis), reviewCheckKey('employer', original));
  const differentMonth = payment({ ...source, period: '2026-08' });
  assert.equal(differentMonth.expected, original.expected);
  assert.notEqual(reviewCheckKey('employer', differentMonth), reviewCheckKey('employer', original));
});

test('employer notices become information and BD payout transfers no longer create review rows', () => {
  const source = report({
    issues: [{ date: '2026-07-01', message: 'Überlapp von Solldienst und BD' }],
    transfers: [{ date: '2026-07-31', label: 'Ausz. BD Stunden Vorm.', hours: 7.84 }]
  });
  const original = structuredClone(source);
  const audit = auditReport(source, rules, emptySettlement('2026-07'));
  assert.equal(audit.information[0].message, 'Überlapp von Solldienst und BD');
  assert.ok(
    !audit.checks.some(check => check.title.startsWith('Arbeitgeberfehler') || check.title.startsWith('Umbuchung'))
  );
  assert.deepEqual(source, original);
  const otherTransfer = auditReport(
    report({ transfers: [{ date: '2026-07-31', label: 'Andere Kontoumbuchung', hours: 2 }] }),
    rules,
    emptySettlement('2026-07')
  );
  assert.equal(otherTransfer.checks.find(check => check.title.startsWith('Umbuchung'))?.status, 'review');
});

test('a present blank overtime wage means zero for arithmetic only, without editing source or inventing pay', () => {
  const source = report({
    totals: { actualHours: 176.4, plannedTarget: 176, contractualTarget: 176.4 },
    wageTypes: { overtimeBonus: null }
  });
  const before = structuredClone(source);
  const audit = auditReport(source, rules, emptySettlement(source.period));
  const check = audit.checks.find(c => c.title.startsWith('Überstundenbasis'))!;
  assert.equal(check.expected, 0);
  assert.equal(check.reported, 0);
  assert.equal(check.status, 'ok');
  assert.equal(audit.hoursSummary.reportedOvertimeHours, 0);
  assert.match(check.detail, /'-' \/ nicht ausgewiesen.*als 0 h/);
  assert.ok(!audit.payLines.some(line => line.label === 'Überstundenzuschlag'));
  assert.ok(!audit.checks.some(c => c.title === 'Auszahlung: Überstundenzuschlag'));
  assert.deepEqual(source, before);
  assert.equal(source.wageTypes.overtimeBonus, null);
  const positive = auditReport(
    { ...source, totals: { ...source.totals, actualHours: 185.75 } },
    rules,
    emptySettlement(source.period)
  );
  const difference = positive.checks.find(c => c.title.startsWith('Überstundenbasis'))!;
  assert.equal(difference.expected, 9.35);
  assert.equal(difference.reported, 0);
  assert.equal(difference.status, 'difference');
  assert.ok(!positive.payLines.some(line => line.label === 'Überstundenzuschlag'));
});

test('an absent overtime wage key remains unknown; numeric source values stay unchanged', () => {
  const source = report({ totals: { actualHours: 8, plannedTarget: 8, contractualTarget: 8 } });
  const missing = auditReport(source, rules, emptySettlement(source.period));
  assert.equal(missing.hoursSummary.reportedOvertimeHours, null);
  assert.equal(missing.checks.find(c => c.title.startsWith('Überstundenbasis'))?.status, 'review');
  assert.equal(Object.hasOwn(source.wageTypes, 'overtimeBonus'), false);
  for (const overtimeBonus of [0, 5.5]) {
    const numeric = auditReport({ ...source, wageTypes: { overtimeBonus } }, rules, emptySettlement(source.period));
    assert.equal(numeric.hoursSummary.reportedOvertimeHours, overtimeBonus);
    assert.doesNotMatch(
      numeric.checks.find(c => c.title.startsWith('Überstundenbasis'))!.detail,
      /nicht ausgewiesen.*als 0 h/
    );
  }
});

test('all employer messages remain readable as information without additional acknowledgement rows', () => {
  const pure = [
    'Ruhezeit nicht eingehalten',
    'Ruhezeit unterschritten',
    'Ruhezeitverletzung',
    '  Ruhezeit nicht eingehalten.  '
  ];
  const other = [
    'Überlapp von Solldienst und BD',
    'Ruhezeit nicht eingehalten; Vergütung prüfen',
    'Ruhezeit unterschritten: Zuschlag fehlt',
    'Ruhezeitverletzung / Entgelt korrigieren',
    'Ruhezeit nicht eingehalten - weitere Buchung',
    'Unbekannter Zeitauswertungsfehler'
  ];
  const issues = [...pure, ...other].map((message, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, '0')}`,
    message
  }));
  const source = report({ issues }),
    before = structuredClone(source);
  const audit = auditReport(source, rules, emptySettlement(source.period));
  assert.deepEqual(
    audit.information.map(issue => issue.message),
    [...pure, ...other]
  );
  assert.deepEqual(
    audit.checks.filter(c => c.title.startsWith('Arbeitgeberfehler')),
    []
  );
  assert.deepEqual(source, before, 'the original employer issues remain intact');
});

test('informational rest-time notices create no review task or additional open month', () => {
  const base = report({
    days: [
      day({
        date: '2026-07-03',
        plannedHours: 8,
        actualHours: 8,
        standbyHours: 0,
        standbyCount: 0,
        nightHours: 0,
        saturdayHours: 0
      })
    ],
    totals: {
      actualHours: 8,
      plannedTarget: 8,
      contractualTarget: 8,
      openingBalance: 0,
      closingBalance: 0,
      monthlyBalance: 0,
      bdHours: 0,
      bdCount: 0
    },
    wageTypes: { night: 0, nightStandby: 0, nightTotal: 0, saturday: 0, overtimeBonus: null }
  });
  const informational = { ...base, issues: [{ date: '2026-07-03', message: 'Ruhezeit nicht eingehalten' }] };
  const settlement = emptySettlement(base.period);
  assert.deepEqual(auditReport(informational, rules, settlement).checks, auditReport(base, rules, settlement).checks);
  const originalContext = getReportReview(base, rules, [], settlement, []),
    informationalContext = getReportReview(informational, rules, [], settlement, []);
  assert.equal(originalContext.openCount, 0);
  assert.equal(informationalContext.openCount, originalContext.openCount);
  assert.ok(!informationalContext.employerChecks.some(c => c.title.startsWith('Arbeitgeberfehler')));
  const workspace = {
    rules,
    entries: [],
    settlements: [settlement],
    acknowledgements: [],
    pendingReports: [],
    pendingEntryImports: []
  };
  assert.deepEqual(
    getReviewMonths({ ...workspace, reports: [informational] }),
    getReviewMonths({ ...workspace, reports: [base] })
  );
  assert.deepEqual(getReviewMonths({ ...workspace, reports: [informational] }), []);
  const financial = {
    ...base,
    issues: [{ date: '2026-07-03', message: 'Ruhezeit nicht eingehalten; Vergütung prüfen' }]
  };
  assert.deepEqual(getReviewMonths({ ...workspace, reports: [financial] }), []);
  const numericDifference = { ...financial, totals: { ...financial.totals, closingBalance: 1 } };
  assert.deepEqual(
    getReviewMonths({ ...workspace, reports: [numericDifference] }),
    ['2026-07'],
    'actual numeric discrepancies still require review'
  );
});

test('opt-out and health account remain source data without recurring reconciliation checks', () => {
  const source = report({ totals: { healthHours: 156.5, optOut: 48 } });
  const withSource = auditReport(source, rules, emptySettlement(source.period));
  const withoutSource = auditReport(report(), rules, emptySettlement(source.period));
  assert.deepEqual(
    withSource.checks,
    withoutSource.checks,
    'these source fields no longer generate monthly review tasks'
  );
  assert.equal(source.totals.optOut, 48);
  assert.equal(source.totals.healthHours, 156.5);
});

test('unknown older table and missing values produce no fabricated pay or zero claims', () => {
  const audit = auditReport(
    report({ period: '2023-09', wageTypes: { night: 10, shiftAllowance: 40 } }),
    rules,
    emptySettlement('2023-09')
  );
  assert.equal(audit.estimatedPay, null);
  assert.deepEqual(audit.payLines, []);
  assert.equal(audit.checks.find(c => c.title.startsWith('Istzeit'))?.status, 'review');
});

test('personal entries flag genuine daytime differences and omit dates without personal logs', () => {
  const r = report({
    days: [
      day({ date: '2026-07-03', label: '', actualHours: 8.5 }),
      day({ date: '2026-07-06', label: '', actualHours: 8 })
    ]
  });
  const entries = [
    { date: '2026-07-03', start: '07:00', end: '16:00', breakMinutes: 0, kind: 'work' as const, note: '', meta: {} }
  ];
  const checks = comparePersonalEntries(r, entries);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].expected, 9);
  assert.equal(checks[0].status, 'difference');
  assert.equal(comparePersonalEntries(r, [{ ...entries[0], breakMinutes: 30 }])[0].status, 'ok');
});

test('personal cross-midnight and complex BD comparisons need manual attribution', () => {
  const entries = [
    { date: '2026-07-01', start: '21:45', end: '08:00', breakMinutes: 0, kind: 'work' as const, note: '', meta: {} }
  ];
  const midnight = comparePersonalEntries(report({ days: [day({ label: '', actualHours: 6.25 })] }), entries);
  assert.equal(midnight[0].status, 'review');
  assert.match(midnight[0].detail, /Mitternacht/);
  const complex = comparePersonalEntries(report({ days: [day({ actualHours: 6.25, standbyHours: 4 })] }), [
    { ...entries[0], start: '02:45', end: '06:45' }
  ]);
  assert.equal(complex[0].status, 'review');
  assert.match(complex[0].detail, /Zuordnung manuell/);
});

test('duplicate personal entries remain review instead of inventing an employer difference', () => {
  const entry = {
    date: '2026-07-01',
    start: '08:00',
    end: '16:00',
    breakMinutes: 0,
    kind: 'work' as const,
    note: '',
    meta: {}
  };
  const result = comparePersonalEntries(report({ days: [day({ label: '', actualHours: 8 })] }), [entry, entry]);
  assert.equal(result[0].status, 'review');
  assert.match(result[0].detail, /Doppelzählungen/);
});

test('DST comparisons need review even when local clock totals match', () => {
  const entry = {
    date: '2026-10-25',
    start: '01:00',
    end: '04:00',
    breakMinutes: 0,
    kind: 'work' as const,
    note: '',
    meta: {}
  };
  const checks = comparePersonalEntries(
    report({ period: '2026-10', days: [day({ date: entry.date, label: '', actualHours: 3 })] }),
    [entry]
  );
  assert.equal(checks[0].status, 'review');
  assert.match(checks[0].detail, /Zeitumstellung/);
});

test('May hours distinguish contractual balance, planned overtime basis and wage claim', () => {
  const source = report({
    period: '2026-05',
    totals: {
      actualHours: 156.5,
      contractualTarget: 144,
      plannedTarget: 151,
      openingBalance: 73.1,
      closingBalance: 85.6,
      monthlyBalance: 12.5
    },
    wageTypes: { overtimeBonus: 5.5 }
  });
  const before = structuredClone(source);
  const audit = auditReport(source, rules, emptySettlement(source.period));
  const h = audit.hoursSummary;
  assert.equal(h.actualHours, 156.5);
  assert.equal(h.contractualTarget, 144);
  assert.equal(h.plannedTarget, 151);
  assert.equal(h.openingBalance, 73.1);
  assert.equal(h.computedClosingBalance, 85.6);
  assert.equal(h.monthlyDelta, 12.5);
  assert.equal(h.plannedDelta, 5.5);
  assert.equal(h.overtimeBasis, 5.5);
  assert.equal(h.reportedOvertimeHours, 5.5);
  assert.deepEqual(h.assumptions, []);
  for (const prefix of ['Zeitkonto', 'Monatssaldo', 'Überstundenbasis'])
    assert.equal(audit.checks.find(c => c.title.startsWith(prefix))?.status, 'ok');
  assert.equal(
    audit.estimatedPay,
    41.97,
    'the wage claim remains the source for 15% pay, rather than the 12.50 monthly balance'
  );
  assert.deepEqual(source, before, 'deriving hours does not edit the employer report');
});

test('missing opening balance preserves its assumption while matching arithmetic is valid', () => {
  const source = report({
    totals: { actualHours: 8, contractualTarget: 8, plannedTarget: 8, closingBalance: 0, monthlyBalance: 0 },
    wageTypes: { overtimeBonus: 0 }
  });
  const audit = auditReport(source, rules, emptySettlement(source.period));
  assert.equal(audit.hoursSummary.openingBalance, 0);
  assert.equal(audit.hoursSummary.evidence.openingBalance, 'assumption');
  assert.ok(audit.hoursSummary.assumptions.some(s => s.includes('Anfangsguthaben') && s.includes('Standardwert 0 h')));
  const balance = audit.checks.find(c => c.title.startsWith('Zeitkonto'))!;
  assert.equal(balance.expected, 0);
  assert.equal(balance.reported, 0);
  assert.equal(balance.status, 'ok');
  assert.equal(audit.checks.find(c => c.title.startsWith('Monatssaldo'))?.status, 'ok');
  assert.equal(audit.checks.find(c => c.title.startsWith('Überstundenbasis'))?.status, 'ok');
});

test('saved actual target and opening amounts are used under visible fallback evidence', () => {
  const source = report({ period: '2026-05', totals: { plannedTarget: 151, closingBalance: 86.6 } });
  const settlement = {
    ...emptySettlement(source.period),
    recordedHours: 156.5,
    targetHours: 144,
    openingHours: 73.1,
    adjustmentHours: 1
  };
  const audit = auditReport(source, rules, settlement);
  assert.equal(audit.hoursSummary.actualHours, 156.5);
  assert.equal(audit.hoursSummary.contractualTarget, 144);
  assert.equal(audit.hoursSummary.openingBalance, 73.1);
  assert.equal(audit.hoursSummary.computedClosingBalance, 86.6);
  assert.equal(audit.hoursSummary.evidence.actualHours, 'settlement');
  assert.equal(audit.hoursSummary.evidence.contractualTarget, 'settlement');
  assert.equal(audit.hoursSummary.evidence.openingBalance, 'settlement');
  assert.equal(audit.checks.find(c => c.title.startsWith('Zeitkonto'))?.status, 'ok');
  assert.equal(audit.checks.find(c => c.title.startsWith('Überstundenbasis'))?.reported, null);
  assert.equal(audit.estimatedPay, null, 'a computed monthly overtime basis must not invent a wage claim');
});

test('17.05 account equality is valid despite an assumed zero opening; missing or different comparison stays distinct', () => {
  const source = report({
    totals: { actualHours: 210.25, contractualTarget: 193.2, closingBalance: 17.05, monthlyBalance: 17.05 },
    wageTypes: { overtimeBonus: 17.05 }
  });
  const settlement = emptySettlement(source.period);
  const audit = auditReport(source, rules, settlement);
  const balance = audit.checks.find(c => c.title.startsWith('Zeitkonto'))!;
  assert.equal(balance.expected, 17.05);
  assert.equal(balance.reported, 17.05);
  assert.equal(balance.status, 'ok');
  assert.match(balance.detail, /Anfangsguthaben fehlt/);
  assert.ok(audit.hoursSummary.assumptions.length > 0);
  for (const prefix of ['Monatssaldo', 'Überstundenbasis'])
    assert.equal(audit.checks.find(c => c.title.startsWith(prefix))?.status, 'ok');
  const different = auditReport({ ...source, totals: { ...source.totals, closingBalance: 16.05 } }, rules, settlement);
  assert.equal(different.checks.find(c => c.title.startsWith('Zeitkonto'))?.status, 'difference');
  const missing = auditReport({ ...source, totals: { ...source.totals, closingBalance: null } }, rules, settlement);
  assert.equal(missing.checks.find(c => c.title.startsWith('Zeitkonto'))?.status, 'review');
});

test('explicitly saved zero opening is a month input rather than an unknown starting balance', () => {
  const source = report({ totals: { actualHours: 210.25, contractualTarget: 193.2, closingBalance: 17.05 } });
  const audit = auditReport(source, rules, { ...emptySettlement(source.period), openingHoursEntered: true });
  assert.equal(audit.hoursSummary.evidence.openingBalance, 'settlement');
  const balance = audit.checks.find(c => c.title.startsWith('Zeitkonto'))!;
  assert.equal(balance.expected, 17.05);
  assert.equal(balance.status, 'ok');
  assert.match(balance.detail, /gespeicherte Monatseingabe 0,00 h/);
  assert.doesNotMatch(balance.detail, /Standardwert|Anfangsstand angenommen/);
});

test('resolved opening origins describe the settings anchor or previous closing balance and expose gaps', () => {
  const source = report({ totals: { actualHours: 8, contractualTarget: 8, plannedTarget: 8 } });
  for (const origin of ['initial', 'previous'] as const) {
    const settlement = {
      ...emptySettlement(source.period),
      openingHours: 73.1,
      openingHoursEntered: true,
      openingHoursOrigin: origin,
      openingHoursGap: 'Kein Nachweis für 2026-06 vorhanden.'
    };
    const audit = auditReport(source, rules, settlement);
    const check = audit.checks.find(c => c.title.startsWith('Zeitkonto'))!;
    assert.equal(audit.hoursSummary.openingBalance, 73.1);
    assert.match(
      check.detail,
      origin === 'initial' ? /Anfangsstand aus den Einstellungen 73,10 h/ : /Endstand des Vormonats 73,10 h/
    );
    assert.match(check.detail, /Kein Nachweis für 2026-06 vorhanden/);
    assert.doesNotMatch(check.detail, /Monatseingabe/);
  }
});

test('profile target fallback accounts for local holidays and historical weekly change', () => {
  const profile = { ...rules, federalState: 'NI', workTimeChangeEnabled: true };
  const may = getEmployerHours(report({ period: '2026-05' }), profile, emptySettlement('2026-05'));
  assert.equal(may.contractualTarget, 144, '21 weekdays minus May1, Ascension, WhitMonday');
  assert.equal(may.evidence.contractualTarget, 'profile');
  const november = getEmployerHours(report({ period: '2025-11' }), profile, emptySettlement('2025-11'));
  assert.equal(november.contractualTarget, 168, '20 weekdays ×8.4h before the weekly reduction');
});

test('partial planned-day lists cannot stand in for the whole monthly plan', () => {
  const source = report({
    period: '2026-05',
    days: [day({ date: '2026-05-03', plannedHours: 8 })],
    totals: { actualHours: 156.5, contractualTarget: 144 },
    wageTypes: { overtimeBonus: 5.5 }
  });
  const audit = auditReport(source, rules, emptySettlement(source.period));
  assert.equal(audit.hoursSummary.plannedTarget, 144);
  assert.equal(audit.hoursSummary.evidence.plannedTarget, 'assumption');
  assert.equal(audit.hoursSummary.overtimeBasis, 12.5);
  assert.ok(audit.hoursSummary.assumptions.some(s => s.includes('1/31') && s.includes('8,00 h')));
  const check = audit.checks.find(c => c.title.startsWith('Überstundenbasis'))!;
  assert.equal(check.expected, 12.5);
  assert.equal(check.reported, 5.5);
  assert.equal(check.status, 'difference');
  assert.equal(audit.estimatedPay, 41.97, 'payment still uses the original reported5.5 hours');
});

test('complete daily planned list may provide a sum with explicit blank-zero assumptions', () => {
  const days = Array.from({ length: 31 }, (_, i) =>
    day({ date: `2026-05-${String(i + 1).padStart(2, '0')}`, plannedHours: i === 0 ? 8 : null })
  );
  const source = report({
    period: '2026-05',
    days,
    totals: { actualHours: 8, contractualTarget: 144 },
    wageTypes: { overtimeBonus: 0 }
  });
  const audit = auditReport(source, rules, emptySettlement(source.period));
  assert.equal(audit.hoursSummary.plannedTarget, 8);
  assert.equal(audit.hoursSummary.evidence.plannedTarget, 'days');
  assert.ok(audit.hoursSummary.assumptions.some(s => s.includes('Nicht ausgewiesene Sollwerte')));
  assert.equal(
    audit.checks.find(c => c.title.startsWith('Überstundenbasis'))?.status,
    'ok',
    'matching arithmetic is valid while the plan assumption remains visible'
  );
});

test('partial actual-day sums remain an explicit partial value; saved and source zero have priority', () => {
  const source = report({
    period: '2026-05',
    days: [day({ date: '2026-05-03', actualHours: 10 })],
    totals: { contractualTarget: 144 }
  });
  const settlement = emptySettlement(source.period);
  const partial = getEmployerHours(source, rules, settlement);
  assert.equal(partial.actualHours, 10);
  assert.equal(partial.evidence.actualHours, 'days');
  assert.ok(partial.assumptions.some(s => s.includes('Teil-/Mindestwert') && s.includes('1/31')));
  const savedZero = getEmployerHours(source, rules, { ...settlement, recordedHours: 0 });
  assert.equal(savedZero.actualHours, 0);
  assert.equal(savedZero.evidence.actualHours, 'settlement');
  const sourceZero = getEmployerHours({ ...source, totals: { ...source.totals, actualHours: 0 } }, rules, {
    ...settlement,
    recordedHours: 100
  });
  assert.equal(sourceZero.actualHours, 0);
  assert.equal(sourceZero.evidence.actualHours, 'report');
});

test('negative planned delta remains visible while arithmetic overtime basis clamps to zero', () => {
  const source = report({
    totals: {
      actualHours: 140,
      contractualTarget: 144,
      plannedTarget: 151,
      openingBalance: 73.1,
      closingBalance: 69.1,
      monthlyBalance: -4
    },
    wageTypes: { overtimeBonus: 0 }
  });
  const audit = auditReport(source, rules, emptySettlement(source.period));
  assert.equal(audit.hoursSummary.monthlyDelta, -4);
  assert.equal(audit.hoursSummary.plannedDelta, -11);
  assert.equal(audit.hoursSummary.overtimeBasis, 0);
  assert.equal(audit.checks.find(c => c.title.startsWith('Überstundenbasis'))?.status, 'ok');
  const differing = auditReport({ ...source, wageTypes: { overtimeBonus: 2 } }, rules, emptySettlement(source.period));
  assert.equal(differing.checks.find(c => c.title.startsWith('Überstundenbasis'))?.status, 'difference');
  assert.equal(
    differing.estimatedPay,
    15.26,
    'reported wage hours remain the payment estimate, regardless of the monthly arithmetic'
  );
});

test('empty source still yields full numeric formula with clearly stated unknown values', () => {
  const source = report({ period: '2026-05' }),
    profile = { ...rules, federalState: 'NI' };
  const audit = auditReport(source, profile, emptySettlement(source.period));
  assert.equal(audit.hoursSummary.actualHours, 0);
  assert.equal(audit.hoursSummary.plannedTarget, 144);
  assert.equal(audit.hoursSummary.computedClosingBalance, -144);
  const balance = audit.checks.find(c => c.title.startsWith('Zeitkonto'))!;
  assert.equal(balance.expected, -144);
  assert.equal(balance.reported, null);
  assert.equal(balance.status, 'review');
  assert.match(balance.detail, /0,00 \+ 0,00 − 144,00 \+ 0,00 = -144,00 h/);
  assert.ok(audit.hoursSummary.assumptions.some(s => s.includes('tatsächliche Monatsarbeitszeit ist unbekannt')));
  assert.equal(audit.estimatedPay, null);
  assert.deepEqual(source.totals, {});
});

test('higher contractual target defines overtime basis while balance and planned delta stay distinct', () => {
  const source = report({
    totals: {
      actualHours: 185.75,
      plannedTarget: 176,
      contractualTarget: 176.4,
      openingBalance: 0,
      closingBalance: 9.35,
      monthlyBalance: 9.35
    },
    wageTypes: { overtimeBonus: 9.35 }
  });
  const audit = auditReport(source, rules, emptySettlement(source.period));
  assert.equal(audit.hoursSummary.plannedDelta, 9.75);
  assert.equal(audit.hoursSummary.monthlyDelta, 9.35);
  assert.equal(audit.hoursSummary.computedClosingBalance, 9.35);
  assert.equal(audit.hoursSummary.overtimeBasis, 9.35);
  const check = audit.checks.find(c => c.title.startsWith('Überstundenbasis'))!;
  assert.equal(check.expected, 9.35);
  assert.equal(check.reported, 9.35);
  assert.equal(check.status, 'ok');
  assert.match(check.title, /max\(Plan; Vertrag\)/);
  assert.match(check.detail, /185,75 − max\(176,00; 176,40\) = 9,35 h/);
  assert.equal(audit.estimatedPay, 71.34, 'pay remains based on reported overtime wage hours');
});

test('higher planned target and equal targets select the correct overtime threshold', () => {
  for (const [plannedTarget, contractualTarget, expected] of [
    [177, 176, 8.75],
    [176.4, 176.4, 9.35]
  ]) {
    const source = report({
      totals: { actualHours: 185.75, plannedTarget, contractualTarget },
      wageTypes: { overtimeBonus: expected }
    });
    const audit = auditReport(source, rules, emptySettlement(source.period));
    assert.equal(audit.hoursSummary.overtimeBasis, expected);
    assert.equal(audit.checks.find(c => c.title.startsWith('Überstundenbasis'))?.status, 'ok');
  }
});

test('positive hours above the lower target do not create overtime below the higher target', () => {
  for (const [plannedTarget, contractualTarget] of [
    [176, 176.4],
    [176.4, 176]
  ]) {
    const source = report({
      totals: { actualHours: 176.3, plannedTarget, contractualTarget },
      wageTypes: { overtimeBonus: 0 }
    });
    const audit = auditReport(source, rules, emptySettlement(source.period));
    assert.equal(audit.hoursSummary.overtimeBasis, 0);
    const check = audit.checks.find(c => c.title.startsWith('Überstundenbasis'))!;
    assert.equal(check.status, 'ok');
    assert.match(check.detail, /= -0,10 h/);
    assert.match(check.detail, /Basis beträgt 0 h/);
  }
});

test('fallback target inputs still use the higher value with visible assumptions', () => {
  const settlement = { ...emptySettlement('2026-07'), targetHours: 176.4 };
  const missingContract = auditReport(
    report({ totals: { actualHours: 185.75, plannedTarget: 176 }, wageTypes: { overtimeBonus: 9.35 } }),
    rules,
    settlement
  );
  assert.equal(missingContract.hoursSummary.overtimeBasis, 9.35);
  assert.equal(missingContract.hoursSummary.evidence.contractualTarget, 'settlement');
  const contractCheck = missingContract.checks.find(c => c.title.startsWith('Überstundenbasis'))!;
  assert.equal(contractCheck.status, 'ok');
  assert.match(contractCheck.detail, /Vertragliches Soll fehlt/);
  const missingPlan = auditReport(
    report({ totals: { actualHours: 185.75, contractualTarget: 176.4 }, wageTypes: { overtimeBonus: 9.35 } }),
    rules,
    emptySettlement('2026-07')
  );
  assert.equal(missingPlan.hoursSummary.overtimeBasis, 9.35);
  assert.equal(missingPlan.hoursSummary.plannedTarget, 176.4);
  const planCheck = missingPlan.checks.find(c => c.title.startsWith('Überstundenbasis'))!;
  assert.equal(planCheck.status, 'ok');
  assert.match(planCheck.detail, /Geplante Sollzeit fehlt/);
});
