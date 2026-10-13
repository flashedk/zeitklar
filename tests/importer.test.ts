import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseText } from '../src/lib/importer';
import { extractPdf } from '../src/lib/server/pdf';
import { reportSignature } from '../src/lib/report-signature';

const text = await readFile(new URL('./fixtures/dpl-july-2026.txt', import.meta.url), 'utf8');

test('actual DPL export keeps service month separate from printed/settlement date', () => {
  const parsed = parseText(text, 'DPL-Daten.txt');
  assert.equal(parsed.entries.length, 0);
  assert.equal(parsed.report?.period, '2026-07');
  assert.equal(parsed.report?.printedAt, '2026-09-30');
  assert.equal(parsed.report?.days.length, 31);
  assert.equal(parsed.report?.rawText, text);
  assert.equal(parsed.report?.filename, 'DPL-Daten.txt');
});

test('DPL reported totals include trailing minus signs and distinguish blank amounts', () => {
  const report = parseText(text).report!;
  assert.equal(report.totals.openingBalance, 71.5);
  assert.equal(report.totals.actualHours, 154.75);
  assert.equal(report.totals.contractualTarget, 184);
  assert.equal(report.totals.plannedTarget, 166.75);
  assert.equal(report.totals.monthlyBalance, -29.25);
  assert.equal(report.totals.closingBalance, 53.65);
  assert.equal(report.totals.bdCount, 4);
  assert.equal(report.totals.bdHours, 20.25);
  assert.equal(report.totals.bdCountI, null);
  assert.equal(report.totals.bdCountII, 4);
  assert.equal(report.totals.bdHoursI, null);
  assert.equal(report.totals.bdHoursII, 20.25);
  assert.equal(report.totals.bdFactoredBuild, 7.84);
  assert.equal(report.totals.bdFactoredTotal, 7.84);
  assert.equal(report.totals.bdFactoredDecrease, null);
  assert.equal(report.totals.healthHours, 179);
  assert.equal(report.totals.holidayBalance, 11.5);
  assert.equal(report.totals.optOut, 48);
});

test('BD Stufe I and II totals aggregate without double-counting and preserve source stages', () => {
  const withStageI = text
    .replace('BD_Anzahl_in_Stufe_I (TVÄ)|             |', 'BD_Anzahl_in_Stufe_I (TVÄ)|    2,00     |')
    .replace('BD_Std._in_Stufe_I   (TVÄ)|             |', 'BD_Std._in_Stufe_I   (TVÄ)|    8,50     |');
  const mixed = parseText(withStageI).report!.totals;
  assert.equal(mixed.bdCountI, 2);
  assert.equal(mixed.bdCountII, 4);
  assert.equal(mixed.bdHoursI, 8.5);
  assert.equal(mixed.bdHoursII, 20.25);
  assert.equal(mixed.bdCount, 6);
  assert.equal(mixed.bdHours, 28.75);
  const stageIOnly = parseText(
    withStageI
      .replace('BD_Anzahl_in_Stufe_II(TVÄ)|    4,00     |', 'BD_Anzahl_in_Stufe_II(TVÄ)|             |')
      .replace('BD_Std._in_Stufe_II  (TVÄ)|   20,25     |', 'BD_Std._in_Stufe_II  (TVÄ)|             |')
  ).report!.totals;
  assert.equal(stageIOnly.bdCountII, null);
  assert.equal(stageIOnly.bdHoursII, null);
  assert.equal(stageIOnly.bdCount, 2);
  assert.equal(stageIOnly.bdHours, 8.5);
  const neither = parseText(
    text
      .replace('BD_Anzahl_in_Stufe_II(TVÄ)|    4,00     |', 'BD_Anzahl_in_Stufe_II(TVÄ)|             |')
      .replace('BD_Std._in_Stufe_II  (TVÄ)|   20,25     |', 'BD_Std._in_Stufe_II  (TVÄ)|             |')
  ).report!.totals;
  assert.equal(neither.bdCount, null);
  assert.equal(neither.bdHours, null);
});

test('DPL daily continuations keep BD duration, weighted amount and night values distinct', () => {
  const days = parseText(text).report!.days;
  assert.equal(days[0].actualHours, 6.25);
  assert.equal(days[0].standbyHours, 4);
  assert.equal(days[0].standbyWeightedHours, 3.8);
  assert.equal(days[0].standbyCount, 1);
  assert.equal(days[0].nightHours, 8.25);
  assert.deepEqual(
    days[0].spans.map(span => [span.start, span.end, span.kind]),
    [
      ['02:45', '06:45', 'unknown'],
      ['21:45', '08:00', 'unknown']
    ]
  );
  assert.equal(days[10].actualHours, 4);
  assert.equal(days[10].plannedHours, null);
  assert.equal(days[10].standbyHours, 8.25);
  assert.equal(days[10].standbyWeightedHours, 7.84);
  assert.equal(days[10].saturdayHours, 0.25);
  assert.equal(days[10].nightHours, 10);
  assert.equal(days[10].spans[1].kind, 'standby');
  assert.equal(days[5].plannedHours, 8);
  assert.equal(days[5].actualHours, null);
  assert.equal(days[1].actualHours, null);
});

test('wage columns, transfer and employer errors are retained', () => {
  const report = parseText(text).report!;
  assert.equal(report.wageTypes.night, 28.75);
  assert.equal(report.wageTypes.nightStandby, 16);
  assert.equal(report.wageTypes.nightTotal, 44.75);
  assert.equal(report.wageTypes.shiftAllowance, 40);
  assert.equal(report.wageTypes.saturday, 0.25);
  assert.equal(report.wageTypes.overtimeBonus, null);
  assert.deepEqual(report.transfers, [{ date: '2026-07-31', label: 'ZBD0 Ausz. BD Stunden Vorm.', hours: 7.84 }]);
  assert.deepEqual(report.issues, [
    { date: '2026-07-01', message: 'Überlapp von Solldienst und BD' },
    { date: '2026-07-31', message: 'Ruhezeit nicht eingehalten' }
  ]);
});

test('actual PDF extraction and TXT produce equivalent daily records and amounts', async () => {
  const bytes = await readFile(new URL('./fixtures/dpl-july-2026.pdf', import.meta.url));
  const extracted = await extractPdf(bytes);
  const pdf = parseText(extracted, 'DPL-Daten.pdf').report!;
  const txt = parseText(text, 'DPL-Daten.txt').report!;
  assert.equal(pdf.period, txt.period);
  assert.equal(pdf.printedAt, txt.printedAt);
  assert.deepEqual(pdf.totals, txt.totals);
  assert.deepEqual(pdf.wageTypes, txt.wageTypes);
  assert.deepEqual(pdf.transfers, txt.transfers);
  assert.deepEqual(pdf.issues, txt.issues);
  const comparable = (days: typeof txt.days) =>
    days.map(({ rawLines, spans, ...day }) => ({ ...day, spans: spans.map(({ raw, ...span }) => span) }));
  assert.deepEqual(comparable(pdf.days), comparable(txt.days));
  assert.equal(
    reportSignature(pdf),
    reportSignature(txt),
    'PDF/TXT must identify the same statement regardless of property insertion order'
  );
});

test('changed DPL table layout produces warning instead of assigning amounts to wrong fields', () => {
  const report = parseText(text.replace('||Nacht |Sa', '|| Nacht |Sa')).report!;
  assert.equal(report.days[0].actualHours, null);
  assert.ok(report.warnings.some(warning => warning.includes('Spaltenlayout')));
});

test('missing daily rows and missing totals are flagged', () => {
  const report = parseText(text.replace(/^\|02 Do.*\r?\n/m, '').replace(/Istzeit/g, 'Andere Zeit')).report!;
  assert.equal(report.days.length, 30);
  assert.equal(report.totals.actualHours, null);
  assert.ok(report.warnings.some(warning => warning.includes('unvollständig')));
  assert.ok(report.warnings.some(warning => warning.includes('Monatssummen')));
});

test('DPL cannot silently assign times to a wrong month', () => {
  assert.throws(() => parseText(text.replace('31.07.2026', '31.08.2026')), /Abrechnungsperiode/);
});

test('generic TXT entry import remains available', () => {
  const parsed = parseText('03.07.2026;07:00;16:00;Pause=30\n2026-07-04 Urlaub', 'own.txt');
  assert.equal(parsed.report, undefined);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].date, '2026-07-03');
  assert.equal(parsed.entries[0].breakMinutes, 30);
  assert.equal(parsed.entries[1].kind, 'vacation');
});
