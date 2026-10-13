import { mayText } from './helpers/synthetic-dpl.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseText } from '../src/lib/importer';
import { validateReport } from '../src/lib/validate-report';
import { minute } from '../src/lib/model';

// Fully invented excerpt covering the report-only 24:00 endpoint.
const text = mayText;
const may = () => parseText(text, 'Mai.txt').report!;

test('May DPL end-of-day 24:00 passes import validation without changing its source date or times', () => {
  const report = may();
  assert.equal(report.period, '2026-05');
  assert.equal(report.printedAt, '2026-06-01');
  assert.equal(report.days[0].date, '2026-05-12');
  assert.equal(report.days[0].actualHours, 6);
  assert.equal(report.days[0].nightHours, 3);
  assert.equal(report.days[0].spans[0].start, '18:00');
  assert.equal(report.days[0].spans[0].end, '24:00');
  assert.equal(validateReport(report), report);
  assert.ok(report.days[0].rawLines[0].includes('18:00 24:00'));
});

test('only report endpoints allow 24:00; invalid hours and minutes still identify the affected field', () => {
  for (const end of ['24:01', '25:00', '23:60', '', '00:00:00']) {
    const report = may();
    report.days[0].spans[0].end = end;
    assert.throws(() => validateReport(report), /2026-05-12.*Endzeit/);
  }
  const report = may();
  report.days[0].spans[0].start = '24:00';
  assert.throws(() => validateReport(report), /2026-05-12.*Beginn/);
  assert.throws(() => minute('24:00'), /Ungültige Uhrzeit/);
});
