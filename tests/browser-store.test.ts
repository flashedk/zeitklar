import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';
import {
  addEntries,
  addReport,
  addPendingReport,
  confirmPendingReport,
  discardPendingReport,
  addPendingEntryImport,
  confirmPendingEntryImport,
  discardPendingEntryImport,
  setReviewAcknowledgement,
  getPage,
  mutate,
  readSnapshot,
  restore
} from '../browser/store';
import { action } from '../browser/forms';
import { dutyEntries } from '../src/lib/duty-entry';
import { calculate } from '../src/lib/calculate';
import { calendarBlocks } from '../src/lib/calendar-spans';
import { defaultRules, emptySettlement, type Rules } from '../src/lib/model';
import { tariffProfile } from '../src/lib/tariff';
import { parseText } from '../src/lib/importer';
Object.defineProperty(globalThis, 'location', {
  value: new URL('https://local.example/?month=2026-07'),
  configurable: true
});

test('manually selected September N/B/N survives storage as regular + BD + regular and gives 3.8 h FZA', async () => {
  const before = await readSnapshot();
  try {
    const duty = {
      name: 'N/B/N',
      regularHours: 5,
      standbyHours: 4,
      secondRegularHours: 1.25,
      bdLevel: 'II' as const,
      bdTimeOff: true,
      times: { start: '21:45', regularEnd: '02:45', standbyEnd: '06:45', end: '08:00' }
    };
    await mutate(s => {
      s.rules = { ...defaultRules, dutyTemplates: [duty] };
    });
    const form = new FormData();
    for (const [key, value] of Object.entries({
      duty: '0',
      date: '2026-09-25',
      start: '21:45',
      end: '08:00',
      breakMinutes: '0',
      note: '',
      meta: '{}'
    }))
      form.set(key, value);
    await action('duty-entry', form);
    const stored = await readSnapshot();
    const rows = stored.entries.filter(entry => entry.meta?.dutyDate === '2026-09-25');
    assert.deepEqual(
      rows.map(entry => [entry.date, entry.start, entry.end, entry.kind]),
      [
        ['2026-09-25', '21:45', '02:45', 'work'],
        ['2026-09-26', '02:45', '06:45', 'standby'],
        ['2026-09-26', '06:45', '08:00', 'work']
      ]
    );
    const result = calculate(rows, stored.rules, '2026-09', emptySettlement('2026-09'));
    assert.ok(Math.abs(result.regular - 6.25) < 1e-8);
    assert.ok(Math.abs(result.standbyCredit - 3.8) < 1e-8);
    assert.equal(result.standbyPaidHours, 0);
    assert.deepEqual(
      calendarBlocks('2026-09-25', [], rows).map(block => [block.displayLabel, block.start, block.end, block.standby]),
      [
        ['BD · Stufe II', '02:45', '06:45', true],
        ['N/B/N', '21:45', '08:00', false]
      ]
    );
  } finally {
    await mutate(s => Object.assign(s, before));
  }
});

test('browser saves FnD after overnight phases and retains FzA plus holiday settings across reads and backup', async () => {
  const before = await readSnapshot();
  try {
    const night = {
      name: 'N',
      regularHours: 5,
      standbyHours: 4,
      secondRegularHours: 1.25,
      bdLevel: 'II' as const,
      bdTimeOff: true
    };
    await mutate(s => addEntries(s, dutyEntries(night, '2032-09-13', '21:45', '08:00'), 'Test'));
    const form = new FormData();
    for (const [key, value] of Object.entries({
      date: '2032-09-14',
      kind: 'rest',
      breakMinutes: '0',
      note: '',
      meta: '{}'
    }))
      form.set(key, value);
    await action('entry', form);
    form.set('date', '2032-09-15');
    form.set('kind', 'timeoff');
    await action('entry', form);
    await mutate(s => {
      s.rules.holidayCompensated = false;
    });
    const saved = await readSnapshot();
    assert.equal(saved.entries.find(e => e.date === '2032-09-14' && e.kind === 'rest')?.start, '');
    assert.ok(saved.entries.some(e => e.kind === 'timeoff' && e.date === '2032-09-15'));
    await restore(JSON.stringify(saved));
    assert.equal((await readSnapshot()).rules.holidayCompensated, false);
  } finally {
    await mutate(s => Object.assign(s, before));
  }
});

test('configured duty phases survive settings saves and invalid edits preserve saved duties', async () => {
  const duty = {
    name: 'Nachtdienst',
    regularHours: 8,
    standbyHours: 14,
    secondRegularHours: 2,
    bdLevel: 'II' as const
  };
  const form = new FormData();
  form.set('rules', JSON.stringify({ ...defaultRules, dutyTemplates: [duty] }));
  await action('rules', form);
  assert.deepEqual((await readSnapshot()).rules.dutyTemplates, [duty]);
  assert.deepEqual((await getPage()).rules.dutyTemplates, [duty]);
  form.set('rules', JSON.stringify({ ...defaultRules, dutyTemplates: [{ ...duty, standbyHours: -1 }] }));
  await assert.rejects(action('rules', form));
  assert.deepEqual((await readSnapshot()).rules.dutyTemplates, [duty]);
  form.set('rules', JSON.stringify({ ...defaultRules, dutyTemplates: [] }));
  await action('rules', form);
  assert.deepEqual((await readSnapshot()).rules.dutyTemplates, []);
});

test('duty selection saves all phases atomically, preserves midnight dates and rejects overlaps', async () => {
  const originalNextId = (await readSnapshot()).nextId;
  const duty = {
    name: 'N',
    regularHours: 5,
    standbyHours: 4,
    secondRegularHours: 1.25,
    bdLevel: 'II' as const,
    times: { start: '21:45', regularEnd: '02:45', standbyEnd: '06:45', end: '08:00' }
  };
  await mutate(s => {
    s.rules.dutyTemplates = [duty];
  });
  const form = new FormData();
  for (const [key, value] of Object.entries({ duty: '0', date: '2028-06-16', start: '21:45', end: '08:00' }))
    form.set(key, value);
  await action('duty-entry', form);
  const rows = (await readSnapshot()).entries.filter(e => e.meta?.dutyDate === '2028-06-16');
  assert.equal(rows.length, 3);
  assert.equal(rows.find(e => e.kind === 'standby')?.meta?.bdLevel, 'II');
  assert.equal(rows.find(e => e.kind === 'standby')?.date, '2028-06-17');
  await action('duty-entry', form);
  assert.equal((await readSnapshot()).entries.filter(e => e.meta?.dutyDate === '2028-06-16').length, 3);
  await mutate(s =>
    addEntries(
      s,
      [{ date: '2028-06-19', start: '03:00', end: '04:00', breakMinutes: 0, kind: 'work', note: '' }],
      'Test'
    )
  );
  const count = (await readSnapshot()).entries.length;
  form.set('date', '2028-06-18');
  await assert.rejects(action('duty-entry', form), /Überschneidung/);
  assert.equal((await readSnapshot()).entries.length, count);
  await mutate(s => {
    s.entries = s.entries.filter(e => !e.date.startsWith('2028-'));
    s.rules.dutyTemplates = [];
    s.nextId = originalNextId;
  });
});
test('browser data survives reads and aborted edits; reports and JSON backup merge locally', async () => {
  const entry = {
    date: '2026-07-03',
    start: '07:00',
    end: '16:00',
    breakMinutes: 30,
    kind: 'work' as const,
    note: 'Eigene Zeit',
    meta: { pauseStart: '12:00' }
  };
  await mutate(s => {
    addEntries(s, [entry], 'Manuell');
    s.rules = { ...defaultRules, federalState: 'BY' };
  });
  const first = await readSnapshot();
  assert.equal(first.entries[0].id, 1);
  assert.equal(first.entries[0].meta?.pauseStart, '12:00');
  await assert.rejects(
    mutate(s =>
      addEntries(
        s,
        [
          { ...entry, breakMinutes: 45 },
          { ...entry, start: '15:00', end: '18:00', meta: {} }
        ],
        'Edit',
        1
      )
    ),
    /Überschneidung/
  );
  assert.equal((await readSnapshot()).entries[0].breakMinutes, 30, 'failed edit transaction preserves original');
  const report = parseText(readFileSync('tests/fixtures/dpl-july-2026.txt', 'utf8')).report!;
  assert.equal(await mutate(s => addReport(s, report)), true);
  assert.equal(
    await mutate(s =>
      addReport(s, {
        ...report,
        filename: 'same.pdf',
        totals: Object.fromEntries(Object.entries(report.totals).reverse())
      })
    ),
    false
  );
  const page = await getPage();
  assert.equal(page.month, '2026-07');
  assert.equal(page.report?.totals.actualHours, 154.75);
  const backup = await readSnapshot();
  const result = await restore(JSON.stringify(backup));
  assert.equal(result.inserted, 0);
  assert.equal(result.duplicates, 1);
  assert.equal(result.addedReports, 0);
  assert.equal((await readSnapshot()).entries.length, 1);
  await assert.rejects(
    restore(JSON.stringify({ ...backup, rules: { ...backup.rules, dailyHours: [-1] } })),
    /Sollstunden/
  );
  assert.equal((await readSnapshot()).reports.length, 1);
});

test('browser report storage and backup restore preserve a DPL end at 24:00', async () => {
  const report = parseText(readFileSync('tests/fixtures/dpl-may-midnight-2026.txt', 'utf8')).report!;
  assert.equal(await mutate(s => addReport(s, report)), true);
  const snapshot = await readSnapshot();
  const stored = snapshot.reports.find(r => r.report.period === '2026-05')!.report;
  assert.equal(stored.days[0].date, '2026-05-04');
  assert.equal(stored.days[0].spans[0].end, '24:00');
  const result = await restore(JSON.stringify(snapshot));
  assert.equal(result.addedReports, 0);
  assert.equal(
    (await readSnapshot()).reports.find(r => r.report.period === '2026-05')!.report.days[0].spans[0].end,
    '24:00'
  );
});

test('browser reads and backup import keep legacy rates manual; stage settings survive saving', async () => {
  const legacy: Record<string, unknown> = {
    ...defaultRules,
    federalState: 'BY',
    group: '2',
    individualRate: 57.34,
    overtimeBaseRate: 52.21
  };
  for (const key of ['stage', 'nextAdvanceDate', 'rateMode']) delete legacy[key];
  // Stored by a pre-v2 version of the app.
  await mutate(s => {
    s.rules = legacy as Rules;
    s.schemaVersion = 1;
  });
  assert.equal((await readSnapshot()).rules.rateMode, 'manual');
  assert.equal(tariffProfile((await readSnapshot()).rules, '2026-07').individualRate, 57.34);
  await mutate(s => {
    s.rules = {
      ...defaultRules,
      federalState: 'BY',
      group: '2',
      stage: 5,
      rateMode: 'table',
      nextAdvanceDate: '2027-05-15'
    };
  });
  const snapshot = await readSnapshot();
  assert.equal(snapshot.rules.stage, 5);
  assert.equal(tariffProfile(snapshot.rules, '2027-05').stage, 6);
  await restore(JSON.stringify({ ...snapshot, rules: legacy }));
  assert.equal((await readSnapshot()).rules.rateMode, 'manual');
  assert.equal((await readSnapshot()).rules.overtimeBaseRate, 52.21);
});

test('browser report queue retains multiple uploads across reads, confirmation and backup restore', async () => {
  const july = parseText(readFileSync('tests/fixtures/dpl-july-2026.txt', 'utf8')).report!;
  const august = {
    ...july,
    period: '2026-08',
    days: july.days.map(day => ({ ...day, date: day.date.replace('2026-07', '2026-08') }))
  };
  const october = {
    ...july,
    period: '2026-10',
    days: july.days.map(day => ({ ...day, date: day.date.replace('2026-07', '2026-10') }))
  };
  assert.equal(await mutate(s => addPendingReport(s, august)), true);
  assert.equal(await mutate(s => addPendingReport(s, october)), true);
  assert.equal(await mutate(s => addPendingReport(s, { ...august, filename: 'same.pdf' })), false);
  assert.equal(await mutate(s => addPendingReport(s, july)), false, 'already confirmed report is skipped');
  const snapshot = await readSnapshot();
  assert.equal(snapshot.pendingReports!.length, 2);
  assert.ok((await getPage()).months.includes('2026-10'));
  assert.ok(!(await readSnapshot()).reports.some(value => value.report.period === '2026-10'));
  const id = snapshot.pendingReports!.find(value => value.report.period === '2026-08')!.id;
  await mutate(s => confirmPendingReport(s, id));
  assert.deepEqual(
    (await readSnapshot()).pendingReports!.map(value => value.report.period),
    ['2026-10']
  );
  await assert.rejects(
    mutate(s => confirmPendingReport(s, id)),
    /nicht gefunden/
  );
  const backup = await readSnapshot(),
    remaining = backup.pendingReports![0];
  await mutate(s => discardPendingReport(s, remaining.id));
  const restored = await restore(JSON.stringify(backup));
  assert.equal(restored.addedPendingReports, 1);
  assert.equal((await readSnapshot()).pendingReports![0].createdAt, remaining.createdAt);
  assert.equal((await restore(JSON.stringify(backup))).addedPendingReports, 0);
});

test('browser generic paste queue persists source, allows edits and restores pending previews', async () => {
  const pasted = new FormData();
  pasted.set('text', '03.11.2026;07:00;16:00;30');
  await action('paste-preview', pasted);
  await mutate(s => addPendingEntryImport(s, parseText('03.12.2026;07:00;16:00;30', 'december.txt')));
  const snapshot = await readSnapshot(),
    pending = snapshot.pendingEntryImports![0];
  assert.equal(snapshot.pendingEntryImports!.length, 2);
  assert.ok((await getPage()).months.includes('2026-12'));
  assert.equal(await mutate(s => addPendingEntryImport(s, { ...pending.preview, filename: 'copy.txt' })), false);
  await assert.rejects(
    mutate(s => confirmPendingEntryImport(s, pending.id, [{ ...pending.preview.entries[0], end: '99:00' }])),
    /Uhrzeit/
  );
  assert.equal((await readSnapshot()).pendingEntryImports![0].preview.text, pending.preview.text);
  const confirm = new FormData();
  confirm.set('importId', String(pending.id));
  confirm.set('entries', JSON.stringify([{ ...pending.preview.entries[0], breakMinutes: 45 }]));
  await action('confirm-entries', confirm);
  assert.equal((await readSnapshot()).entries.find(entry => entry.date === '2026-11-03')!.breakMinutes, 45);
  const backup = await readSnapshot();
  assert.equal(backup.pendingEntryImports!.length, 1);
  await mutate(s => discardPendingEntryImport(s, s.pendingEntryImports![0].id));
  assert.equal((await restore(JSON.stringify(backup))).addedPendingEntryImports, 1);
  assert.equal((await readSnapshot()).pendingEntryImports!.length, 1);
});

test('legacy browser snapshots normalize absent queues and an outdated nextId', async () => {
  await mutate(s => {
    const legacy = s as Partial<typeof s>;
    delete legacy.pendingReports;
    delete legacy.pendingEntryImports;
    delete legacy.acknowledgements;
    s.nextId = 1;
  });
  const snapshot = await readSnapshot();
  assert.deepEqual(snapshot.pendingReports, []);
  assert.deepEqual(snapshot.pendingEntryImports, []);
  assert.deepEqual(snapshot.acknowledgements, []);
  assert.ok(snapshot.nextId > Math.max(...snapshot.entries.map(entry => entry.id!)));
});

test('browser review acknowledgements persist, affect global months and survive backup merge', async () => {
  const report = {
    period: '2026-09',
    printedAt: '2026-10-06',
    filename: 'September.txt',
    days: [],
    totals: {},
    wageTypes: {},
    transfers: [],
    issues: [],
    warnings: [],
    rawText: 'Synthetischer Zeitnachweis für Quittierungstests.'
  };
  await mutate(s => {
    addReport(s, report);
    addReport(s, { ...report, period: '2026-10', filename: 'October.txt' });
  });
  Object.defineProperty(globalThis, 'location', {
    value: new URL('https://local.example/?month=2026-09'),
    configurable: true
  });
  const before = await getPage(),
    review = before.review!;
  const checks = [...review.employerChecks, ...review.personalChecks].filter(check => check.status === 'review');
  assert.ok(checks.length > 0);
  for (const check of checks) {
    const form = new FormData();
    form.set('reportKey', review.reportKey);
    form.set('checkKey', check.key);
    form.set('acknowledged', 'true');
    await action('acknowledge', form);
  }
  const after = await getPage();
  assert.equal(after.review!.openCount, 0);
  assert.equal(after.reviewMonths.length, before.reviewMonths.length - 1);
  assert.ok(!after.reviewMonths.includes('2026-09'));
  assert.ok(after.reviewMonths.includes('2026-10'));
  const snapshot = await readSnapshot(),
    first = snapshot.acknowledgements![0];
  await mutate(s => setReviewAcknowledgement(s, first.reportKey, first.checkKey, true));
  assert.deepEqual((await readSnapshot()).acknowledgements![0], first);
  const backup = JSON.stringify(await readSnapshot());
  await mutate(s => setReviewAcknowledgement(s, first.reportKey, first.checkKey, false));
  assert.equal((await getPage()).review!.openCount, 1);
  assert.equal((await restore(backup)).addedReviewAcknowledgements, 1);
  assert.equal((await getPage()).review!.openCount, 0);
  assert.deepEqual(
    (await readSnapshot()).acknowledgements!.find(
      value => value.checkKey === first.checkKey && value.reportKey === first.reportKey
    ),
    first
  );
  const changedTimestamp = JSON.parse(backup);
  changedTimestamp.acknowledgements[0].acknowledgedAt = '2026-01-01T00:00:00.000Z';
  assert.equal((await restore(JSON.stringify(changedTimestamp))).addedReviewAcknowledgements, 0);
  assert.deepEqual(
    (await readSnapshot()).acknowledgements!.find(
      value => value.checkKey === first.checkKey && value.reportKey === first.reportKey
    ),
    first,
    'existing timestamps win during merges'
  );
  await mutate(s => addReport(s, { ...report, printedAt: '2026-10-07' }));
  await assert.rejects(
    mutate(s => setReviewAcknowledgement(s, first.reportKey, first.checkKey, true)),
    /veraltet/
  );
  assert.ok((await getPage()).review!.openCount > 0);
  const invalid = JSON.parse(backup);
  invalid.acknowledgements[0].checkKey = 'arbitrary';
  await assert.rejects(restore(JSON.stringify(invalid)), /Quittierung|quittierung|Prüf|Kennung/);
  assert.equal((await readSnapshot()).acknowledgements!.length, checks.length);
  Object.defineProperty(globalThis, 'location', {
    value: new URL('https://local.example/?month=2026-07'),
    configurable: true
  });
  const july = (await getPage()).review!,
    okay = july.employerChecks.find(check => check.status === 'ok')!;
  assert.ok(okay);
  await assert.rejects(
    mutate(s => setReviewAcknowledgement(s, july.reportKey, okay.key, true)),
    /nicht quittiert/
  );
});

test('browser saves zero as an entered opening and retains absent-value metadata in backups', async () => {
  const zero = new FormData();
  zero.set('month', '2027-01');
  zero.set('openingHours', '0');
  await action('settlement', zero);
  const absent = new FormData();
  absent.set('month', '2027-02');
  absent.set('openingHours', '');
  await action('settlement', absent);
  const snapshot = await readSnapshot();
  assert.equal(snapshot.settlements.find(value => value.month === '2027-01')!.openingHoursEntered, true);
  assert.equal(snapshot.settlements.find(value => value.month === '2027-02')!.openingHoursEntered, false);
  await restore(JSON.stringify(snapshot));
  assert.equal((await readSnapshot()).settlements.find(value => value.month === '2027-01')!.openingHoursEntered, true);
  assert.equal((await readSnapshot()).settlements.find(value => value.month === '2027-02')!.openingHoursEntered, false);
  // Stored by a pre-v2 version of the app.
  await mutate(s => {
    delete s.settlements.find(value => value.month === '2027-01')!.openingHoursEntered;
    s.schemaVersion = 1;
  });
  assert.equal(
    (await readSnapshot()).settlements.find(value => value.month === '2027-01')!.openingHoursEntered,
    true,
    'legacy stored zero is migrated'
  );
});

test('browser month-settings patches only submitted values and rejects invalid adjustments', async () => {
  const legacy = new FormData();
  legacy.set('month', '2027-03');
  legacy.set('recordedHours', '123');
  legacy.set('extraPay', '456');
  legacy.set('note', 'erhalten');
  await action('settlement', legacy);
  const correction = new FormData();
  correction.set('month', '2027-03');
  correction.set('adjustmentHours', '2,5');
  await action('month-settings', correction);
  const stored = (await readSnapshot()).settlements.find(value => value.month === '2027-03')!;
  assert.equal(stored.recordedHours, 123);
  assert.equal(stored.extraPay, 456);
  assert.equal(stored.note, 'erhalten');
  assert.equal(stored.adjustmentHours, 2.5);
  const note = new FormData();
  note.set('month', '2027-03');
  note.set('note', 'neu');
  await action('month-settings', note);
  assert.equal((await readSnapshot()).settlements.find(value => value.month === '2027-03')!.adjustmentHours, 2.5);
  correction.set('adjustmentHours', 'NaN');
  await assert.rejects(action('month-settings', correction));
  correction.set('month', '2027-13');
  await assert.rejects(action('month-settings', correction));
});

test('browser page carries an own-entry August balance into September and prefers a later employer closing', async () => {
  const before = await readSnapshot(),
    locationBefore = Object.getOwnPropertyDescriptor(globalThis, 'location')!;
  try {
    Object.defineProperty(globalThis, 'location', {
      value: new URL('https://local.example/?month=2029-09'),
      configurable: true
    });
    await mutate(s => {
      s.rules = {
        ...defaultRules,
        tariff: false,
        federalState: 'BY',
        dailyHours: [0, 0, 0, 0, 0, 0, 0],
        openingMonth: '2029-08',
        openingHours: 20,
        openingHoursEntered: true
      };
      s.reports = [];
      s.entries = ['2029-08-03', '2029-09-03'].map(date => ({
        date,
        start: '08:00',
        end: '16:00',
        breakMinutes: 0,
        kind: 'work',
        note: ''
      }));
      s.settlements = [{ ...emptySettlement('2029-08'), adjustmentHours: 1.25 }];
    });
    const personal = await getPage();
    assert.equal(personal.report, null);
    assert.equal(personal.settlement.openingHours, 29.25);
    assert.equal(personal.settlement.openingHoursOrigin, 'personal');
    assert.ok(
      Math.abs(calculate(personal.entries, personal.rules, personal.month, personal.settlement).balance - 37.25) < 1e-8
    );
    await mutate(s =>
      addReport(s, {
        period: '2029-08',
        printedAt: '2029-10-12',
        filename: 'August.txt',
        days: [],
        totals: { closingBalance: 41.5 },
        wageTypes: {},
        issues: [],
        transfers: [],
        warnings: [],
        rawText: ''
      })
    );
    const official = await getPage();
    assert.equal(official.settlement.openingHours, 41.5);
    assert.equal(official.settlement.openingHoursOrigin, 'previous');
    assert.equal(official.settlement.openingHoursGap, undefined);
  } finally {
    await mutate(s => Object.assign(s, before));
    Object.defineProperty(globalThis, 'location', locationBefore);
  }
});
