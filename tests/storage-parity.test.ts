import { julyText } from './helpers/synthetic-dpl.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import 'fake-indexeddb/auto';
import { runAction, type ActionStore } from '../src/lib/actions';
import { buildPage, exportSnapshot, SCHEMA_VERSION } from '../src/lib/workspace';
import { defaultRules, emptySettlement } from '../src/lib/model';
import * as browser from '../browser/store';

// A database written by an earlier version: no meta table, legacy rules without rateMode,
// and a saved zero opening without the openingHoursEntered flag.
mkdirSync('tmp', { recursive: true });
process.env.DATA_DIR = mkdtempSync(resolve('tmp/storage-parity-'));
const legacyRules: Record<string, unknown> = { ...defaultRules, group: '2', individualRate: 57.34 };
delete legacyRules.rateMode;
const legacySettlement: Record<string, unknown> = { ...emptySettlement('2025-01'), openingHours: 0 };
delete legacySettlement.openingHoursEntered;
{
  const legacy = new DatabaseSync(resolve(process.env.DATA_DIR, 'zeitklar.sqlite'));
  legacy.exec(`CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE settlements (month TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  legacy.prepare('INSERT INTO settings(id,value) VALUES (1,?)').run(JSON.stringify(legacyRules));
  legacy.prepare('INSERT INTO settlements(month,value) VALUES (?,?)').run('2025-01', JSON.stringify(legacySettlement));
  legacy.close();
}
const server = await import('../src/lib/server/db');

test('a legacy SQLite file is migrated once on open and the result is persisted', () => {
  assert.equal(server.getRules().rateMode, 'manual');
  const raw = new DatabaseSync(resolve(process.env.DATA_DIR!, 'zeitklar.sqlite'), { readOnly: true });
  try {
    const meta = raw.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get() as { value: string };
    assert.equal(Number(meta.value), SCHEMA_VERSION);
    const rules = JSON.parse(String((raw.prepare('SELECT value FROM settings').get() as { value: string }).value));
    assert.equal(rules.rateMode, 'manual', 'migrated rules are written back');
    const settlement = JSON.parse(
      String((raw.prepare("SELECT value FROM settlements WHERE month='2025-01'").get() as { value: string }).value)
    );
    assert.equal(settlement.openingHoursEntered, true);
  } finally {
    raw.close();
  }
});

const july = julyText;
const form = (fields: Record<string, string>) => {
  const value = new FormData();
  for (const [key, field] of Object.entries(fields)) value.set(key, field);
  return value;
};
const noPdf = async () => {
  throw new Error('not used');
};
// Timestamps and the per-store id counter are the only values allowed to differ.
const comparable = (value: unknown) =>
  JSON.parse(JSON.stringify(value).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<time>'));

async function scenario(store: ActionStore, page: () => Promise<ReturnType<typeof buildPage>>) {
  const run = (name: string, fields: Record<string, string>) => runAction(name, form(fields), store);
  await run('rules', {
    rules: JSON.stringify({ ...defaultRules, federalState: 'BY', group: '2', stage: 3, confirmed: true })
  });
  // A second profile version from August with a different surcharge; July keeps the first one.
  await run('rules-version', { month: '2026-08', operation: 'split' });
  await run('rules', {
    month: '2026-08',
    rules: JSON.stringify({
      ...defaultRules,
      federalState: 'BY',
      group: '2',
      stage: 3,
      confirmed: true,
      nightPercent: 30
    })
  });
  await run('paste-preview', { text: july });
  const pending = (await page()).pendingReports[0];
  await run('confirm', { reportId: String(pending.id) });
  await run('entry', {
    date: '2026-07-21',
    start: '07:00',
    end: '15:30',
    breakMinutes: '30',
    kind: 'work',
    note: 'parity',
    meta: '{}'
  });
  await run('month-settings', { month: '2026-07', adjustmentHours: '1,5', note: 'Notiz' });
  // The case that used to differ: an explicit flag must win over the presence of a value.
  await run('settlement', { month: '2026-06', openingHours: '5', openingHoursEntered: 'false' });
  const open = (await page()).review!.employerChecks.find(check => check.status === 'review' && check.key)!;
  await run('acknowledge', { reportKey: (await page()).review!.reportKey, checkKey: open.key, acknowledged: 'true' });
  await assert.rejects(run('delete', { id: 'x' }), /Ungültiger Eintrag/);
  await assert.rejects(run('nope', {}), /Unbekannte Aktion/);
  return page();
}

test('the same actions produce the same workspace on SQLite and IndexedDB', async () => {
  // Start both from an empty workspace.
  server.mutateSync(s => Object.assign(s, emptyFrom(s)));
  const url = new URL('http://localhost/?month=2026-07');
  const serverPage = await scenario({ mutate: server.mutate, extractPdf: noPdf }, async () =>
    buildPage(server.readSnapshot(), url)
  );
  const browserPage = await scenario({ mutate: browser.mutate, extractPdf: noPdf }, async () =>
    buildPage(await browser.readSnapshot(), url)
  );
  // Guard against a trivially equal comparison: the scenario must have produced real data.
  assert.equal(serverPage.reports.length, 1);
  assert.equal(serverPage.entries.length, 1);
  assert.equal(serverPage.settlement.adjustmentHours, 1.5);
  assert.deepEqual(
    serverPage.rules.previous?.map(version => version.validUntil),
    ['2026-07']
  );
  assert.ok(serverPage.review!.employerChecks.some(check => check.acknowledgedAt));
  assert.equal(serverPage.review!.openCount, browserPage.review!.openCount);
  assert.deepEqual(comparable(serverPage), comparable(browserPage));
  assert.deepEqual(
    comparable(exportSnapshot(server.readSnapshot())),
    comparable(exportSnapshot(await browser.readSnapshot()))
  );
  const settlement = server.getSettlement('2026-06');
  assert.equal(settlement.openingHoursEntered, false);
});

function emptyFrom(s: ReturnType<typeof server.readSnapshot>) {
  return {
    rules: structuredClone(defaultRules),
    entries: [],
    settlements: [],
    reports: [],
    pendingReports: [],
    pendingEntryImports: [],
    acknowledgements: [],
    nextId: 1,
    schemaVersion: s.schemaVersion
  };
}

test('a browser backup restores into the server through the shared restore action', async () => {
  const exported = JSON.stringify(exportSnapshot(await browser.readSnapshot()));
  server.mutateSync(s => Object.assign(s, emptyFrom(s)));
  const backup = new FormData();
  backup.set('backup', new File([exported], 'zeitklar-lokal-export.json', { type: 'application/json' }));
  const result = await runAction('restore', backup, { mutate: server.mutate, extractPdf: noPdf });
  assert.equal(result.inserted, 1);
  assert.equal(result.addedReports, 1);
  assert.match(String(result.success), /1 eigene Einträge und 1 Nachweise/);
  const url = new URL('http://localhost/?month=2026-07');
  const restored = buildPage(server.readSnapshot(), url);
  const original = buildPage(await browser.readSnapshot(), url);
  assert.equal(restored.review!.openCount, original.review!.openCount, 'acknowledgements survive the round trip');
  assert.equal(restored.settlement.adjustmentHours, 1.5);
  const empty = new FormData();
  await assert.rejects(runAction('restore', empty, { mutate: server.mutate, extractPdf: noPdf }), /Sicherungsdatei/);
});
