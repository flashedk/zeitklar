// Run against an isolated running server: BASE_URL=http://127.0.0.1:... node scripts/smoke.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, unflatten } from 'devalue';
const base = process.env.BASE_URL || 'http://127.0.0.1:5174';
const auth = process.env.SMOKE_PASSWORD
  ? { authorization: `Basic ${Buffer.from(`zeitklar:${process.env.SMOKE_PASSWORD}`).toString('base64')}` }
  : {};
async function action(name, form, expected = 200) {
  const response = await fetch(`${base}/?/` + name, {
    method: 'POST',
    headers: { ...auth, origin: base, accept: 'application/json', 'x-sveltekit-action': 'true' },
    body: form
  });
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.status, expected);
  return { type: result.type, data: result.data ? parse(result.data) : result };
}
const pdfForm = new FormData();
pdfForm.set(
  'file',
  new File([readFileSync('tests/fixtures/dpl-july-2026.pdf')], 'DPL-Daten.pdf', { type: 'application/pdf' })
);
const pdf = await action('preview', pdfForm);
assert.equal(pdf.type, 'success');
assert.equal(pdf.data.preview.report.period, '2026-07');
const txtForm = new FormData();
txtForm.set(
  'file',
  new File([readFileSync('tests/fixtures/dpl-july-2026.txt')], 'DPL-Daten.txt', { type: 'text/plain' })
);
const txt = await action('preview', txtForm);
assert.deepEqual(pdf.data.preview.report.totals, txt.data.preview.report.totals);
assert.deepEqual(pdf.data.preview.report.wageTypes, txt.data.preview.report.wageTypes);
const pastedForm = new FormData();
pastedForm.set('text', readFileSync('tests/fixtures/dpl-july-2026.txt', 'utf8'));
const pasted = await action('paste-preview', pastedForm);
assert.equal(pasted.data.preview.report.period, '2026-07');
assert.deepEqual(pasted.data.preview.report.totals, txt.data.preview.report.totals);
const batchForm = new FormData();
batchForm.append('file', new File([readFileSync('tests/fixtures/dpl-may-midnight-2026.txt')], 'Mai.txt'));
batchForm.append('file', new File(['unreadable file'], 'broken.pdf'));
const batch = await action('preview', batchForm);
assert.deepEqual(batch.data.uploadMonths, ['2026-05']);
assert.equal(batch.data.uploadErrors[0].name, 'broken.pdf');
const pendingData = await (await fetch(`${base}/api/export`, { headers: auth })).json();
assert.deepEqual(pendingData.pendingReports.map(v => v.report.period).sort(), ['2026-05', '2026-07']);
const confirmMay = new FormData();
confirmMay.set('reportId', String(pendingData.pendingReports.find(v => v.report.period === '2026-05').id));
assert.equal((await action('confirm', confirmMay)).data.importedMonth, '2026-05');
const afterConfirmation = await (await fetch(`${base}/api/export`, { headers: auth })).json();
assert.deepEqual(
  afterConfirmation.pendingReports.map(v => v.report.period),
  ['2026-07'],
  'confirming one upload preserves the other month'
);
if (process.env.SMOKE_PASSWORD) assert.equal((await fetch(`${base}/api/export`)).status, 401);
const importForm = new FormData();
importForm.set('report', JSON.stringify(pdf.data.preview.report));
assert.equal((await action('import', importForm)).data.importedMonth, '2026-07');
const equivalent = new FormData();
equivalent.set('report', JSON.stringify(txt.data.preview.report));
await action('import', equivalent);
const data = await (await fetch(`${base}/api/export`, { headers: auth })).json();
const julyReports = data.reports.filter(r => r.report.period === '2026-07');
assert.equal(julyReports.length, 1, 'PDF/TXT of identical report must deduplicate');
assert.equal(julyReports[0].report.totals.actualHours, 154.75);
const entry = new FormData();
for (const [key, value] of Object.entries({
  date: '2026-07-03',
  start: '07:00',
  end: '16:00',
  breakMinutes: '30',
  kind: 'work',
  note: 'Smoke test',
  meta: '{"pauseStart":"12:00"}'
}))
  entry.set(key, value);
assert.equal((await action('entry', entry)).data.saved, true);
const saved = await (await fetch(`${base}/api/export`, { headers: auth })).json();
assert.equal(saved.entries[0].meta.pauseStart, '12:00');
const settings = new FormData();
settings.set(
  'rules',
  JSON.stringify({
    ...saved.rules,
    federalState: 'BY',
    localAssumption: true,
    individualRate: 50.88,
    group: '2',
    confirmed: true
  })
);
assert.equal((await action('rules', settings)).type, 'success');
const invalid = new FormData();
invalid.set('report', JSON.stringify({ ...pdf.data.preview.report, period: 'wrong' }));
assert.equal((await action('import', invalid, 400)).type, 'failure');
const csrf = await fetch(`${base}/?/delete`, {
  method: 'POST',
  headers: { ...auth, origin: 'https://untrusted.example', 'content-type': 'application/x-www-form-urlencoded' },
  body: 'id=1'
});
assert.equal(csrf.status, 403);
const annualHtml = await (await fetch(`${base}/?month=2026-07`, { headers: auth })).text();
assert.ok(
  annualHtml.includes('Jahresübersicht 2026') &&
    annualHtml.includes('Zusatzvergütung im Jahresmittel') &&
    annualHtml.includes('Zeitkonto im Jahresverlauf')
);
const html = await (await fetch(`${base}/?month=2026-07&tab=Monat`, { headers: auth })).text();
assert.ok(html.includes('Juli 2026') && html.includes('154,75'));
const mayForm = new FormData();
mayForm.set('text', readFileSync('tests/fixtures/dpl-may-midnight-2026.txt', 'utf8'));
const mayPreview = await action('paste-preview', mayForm);
assert.equal(mayPreview.data.preview.report.days[0].spans[0].end, '24:00');
const mayImport = new FormData();
mayImport.set('report', JSON.stringify(mayPreview.data.preview.report));
assert.equal((await action('import', mayImport)).data.importedMonth, '2026-05');
const withMay = await (await fetch(`${base}/api/export`, { headers: auth })).json();
assert.equal(withMay.reports.find(r => r.report.period === '2026-05').report.days[0].spans[0].end, '24:00');
const mayChecks = (await pageData('2026-05')).review.employerChecks;
const assumedAccount = mayChecks.find(check => check.title.startsWith('Zeitkonto'));
assert.equal(
  assumedAccount.expected,
  12.5,
  'missing opening balance uses an explicit zero/manual assumption instead of a blank result'
);
assert.equal(assumedAccount.status, 'review');
assert.match(assumedAccount.detail, /0,00/);
assert.equal(mayChecks.find(check => check.title.startsWith('Monatssaldo')).expected, 12.5);
const completeMay = {
  ...mayPreview.data.preview.report,
  totals: {
    ...mayPreview.data.preview.report.totals,
    openingBalance: 73.1,
    closingBalance: 85.6,
    plannedTarget: 151,
    monthlyBalance: 12.5
  },
  wageTypes: { ...mayPreview.data.preview.report.wageTypes, overtimeBonus: 5.5 }
};
const correctedMay = new FormData();
correctedMay.set('report', JSON.stringify(completeMay));
await action('import', correctedMay);
const completeMayChecks = (await pageData('2026-05')).review.employerChecks;
assert.equal(completeMayChecks.find(check => check.title.startsWith('Zeitkonto')).expected, 85.6);
assert.equal(completeMayChecks.find(check => check.title.startsWith('Zeitkonto')).status, 'ok');
const overtimeCalculation = completeMayChecks.find(check => check.title.startsWith('Überstundenbasis'));
assert.equal(overtimeCalculation.expected, 5.5);
assert.equal(overtimeCalculation.reported, 5.5);
assert.equal(overtimeCalculation.status, 'ok');
const higherContract = {
  ...completeMay,
  period: '2026-04',
  days: [],
  totals: {
    actualHours: 185.75,
    contractualTarget: 176.4,
    plannedTarget: 176,
    openingBalance: 0,
    closingBalance: 9.35,
    monthlyBalance: 9.35
  },
  wageTypes: { overtimeBonus: 9.35 }
};
const higherContractImport = new FormData();
higherContractImport.set('report', JSON.stringify(higherContract));
await action('import', higherContractImport);
const higherContractCheck = (await pageData('2026-04')).review.employerChecks.find(check =>
  check.title.startsWith('Überstundenbasis')
);
assert.equal(
  higherContractCheck.expected,
  9.35,
  'the higher contractual target is deducted even when the planned target is lower'
);
assert.equal(higherContractCheck.reported, 9.35);
assert.equal(higherContractCheck.status, 'ok');
assert.match(higherContractCheck.detail, /176,00/);
assert.match(higherContractCheck.detail, /176,40/);
const zeroOvertimeSource = {
  ...higherContract,
  period: '2026-02',
  totals: { actualHours: 158.25, plannedTarget: 163.5, contractualTarget: 160 },
  wageTypes: { overtimeBonus: null },
  issues: [{ date: '2026-02-25', message: 'Ruhezeit nicht eingehalten' }]
};
const zeroOvertimeImport = new FormData();
zeroOvertimeImport.set('report', JSON.stringify(zeroOvertimeSource));
await action('import', zeroOvertimeImport);
const zeroOvertimePage = await pageData(zeroOvertimeSource.period);
const zeroOvertimeCheck = zeroOvertimePage.review.employerChecks.find(check =>
  check.title.startsWith('Überstundenbasis')
);
assert.equal(zeroOvertimeCheck.expected, 0);
assert.equal(zeroOvertimeCheck.reported, 0);
assert.equal(zeroOvertimeCheck.status, 'ok');
assert.ok(!zeroOvertimePage.review.employerChecks.some(check => check.title.startsWith('Arbeitgeberfehler')));
const zeroOvertimeHtml = await (await fetch(`${base}/?month=2026-02&tab=Monat`, { headers: auth })).text();
assert.ok(
  zeroOvertimeHtml.includes('Hinweise aus dem Nachweis') && zeroOvertimeHtml.includes('Ruhezeit nicht eingehalten')
);
const autoSettings = new FormData();
autoSettings.set(
  'rules',
  JSON.stringify({
    ...saved.rules,
    group: '2',
    stage: 5,
    nextAdvanceDate: '2026-07-15',
    rateMode: 'table',
    federalState: 'BY',
    confirmed: true
  })
);
assert.equal((await action('rules', autoSettings)).type, 'success');
const withStage = await (await fetch(`${base}/api/export`, { headers: auth })).json();
assert.equal(withStage.rules.stage, 5);
assert.equal(withStage.rules.nextAdvanceDate, '2026-07-15');
assert.equal(withStage.rules.rateMode, 'table');
const badStage = new FormData();
badStage.set('rules', JSON.stringify({ ...withStage.rules, group: '4', stage: 6 }));
assert.equal((await action('rules', badStage, 400)).type, 'failure');
assert.equal((await (await fetch(`${base}/api/export`, { headers: auth })).json()).rules.stage, 5);
async function pageData(month) {
  const response = await fetch(`${base}/__data.json?month=${month}`, { headers: auth });
  assert.equal(response.status, 200);
  const result = await response.json();
  return unflatten(result.nodes.find(node => node?.type === 'data' && node.data)?.data);
}
const reviewSource = {
  period: '2026-09',
  printedAt: '2026-11-30',
  filename: 'Review smoke.txt',
  days: [],
  totals: {},
  wageTypes: { night: 10 },
  transfers: [],
  issues: [],
  warnings: [],
  rawText: 'Isolated review smoke fixture'
};
for (const month of ['2026-09', '2026-10']) {
  const form = new FormData();
  form.set('report', JSON.stringify({ ...reviewSource, period: month }));
  await action('import', form);
}
const beforeReview = await pageData('2026-09');
assert.ok(beforeReview.reviewMonths.includes('2026-09') && beforeReview.reviewMonths.includes('2026-10'));
const review = beforeReview.review;
assert.ok(review.openCount > 1, 'multiple checks belong to a single outstanding month');
for (const check of review.employerChecks.filter(check => check.status === 'review')) {
  const form = new FormData();
  form.set('reportKey', review.reportKey);
  form.set('checkKey', check.key);
  form.set('acknowledged', 'true');
  await action('acknowledge', form);
}
const afterReview = await pageData('2026-09');
assert.equal(afterReview.review.openCount, 0);
assert.equal(afterReview.reviewMonths.length, beforeReview.reviewMonths.length - 1);
assert.ok(!afterReview.reviewMonths.includes('2026-09') && afterReview.reviewMonths.includes('2026-10'));
const acknowledgements = (await (await fetch(`${base}/api/export`, { headers: auth })).json()).acknowledgements;
assert.equal(
  acknowledgements.filter(value => value.reportKey === review.reportKey).length,
  review.employerChecks.filter(check => check.status === 'review').length
);
const revoke = new FormData();
revoke.set('reportKey', review.reportKey);
revoke.set('checkKey', review.employerChecks[0].key);
revoke.set('acknowledged', 'false');
await action('acknowledge', revoke);
assert.ok((await pageData('2026-09')).reviewMonths.includes('2026-09'));
const replacement = new FormData();
replacement.set('report', JSON.stringify({ ...reviewSource, printedAt: '2026-12-01' }));
await action('import', replacement);
const stale = new FormData();
stale.set('reportKey', review.reportKey);
stale.set('checkKey', review.employerChecks[0].key);
stale.set('acknowledged', 'true');
assert.equal((await action('acknowledge', stale, 400)).type, 'failure');
assert.ok((await pageData('2026-09')).review.openCount > 0);
const zeroSource = {
  ...reviewSource,
  period: '2025-07',
  printedAt: '2025-09-30',
  filename: 'Saved-zero smoke.txt',
  totals: {
    actualHours: 210.25,
    contractualTarget: 193.2,
    plannedTarget: 193.5,
    closingBalance: 17.05,
    monthlyBalance: 17.05
  },
  wageTypes: { overtimeBonus: 16.75 }
};
const zeroImport = new FormData();
zeroImport.set('report', JSON.stringify(zeroSource));
await action('import', zeroImport);
const savedZero = new FormData();
savedZero.set('month', zeroSource.period);
savedZero.set('openingHours', '0');
await action('settlement', savedZero);
const zeroPage = await pageData(zeroSource.period);
assert.equal(zeroPage.settlement.openingHoursEntered, true);
const zeroCheck = zeroPage.review.employerChecks.find(check => check.title.startsWith('Zeitkonto'));
assert.equal(zeroCheck.expected, 17.05);
assert.equal(zeroCheck.reported, 17.05);
assert.equal(zeroCheck.status, 'ok');
assert.match(zeroCheck.detail, /einmaliger Anfangsstand aus den Einstellungen 0,00 h/);
assert.doesNotMatch(zeroCheck.detail, /Standardwert/);
assert.equal(zeroPage.rules.openingMonth, zeroSource.period);
const notePatch = new FormData();
notePatch.set('month', zeroSource.period);
notePatch.set('note', 'Separat gespeicherte Monatsnotiz');
await action('month-settings', notePatch);
const correctionPatch = new FormData();
correctionPatch.set('month', zeroSource.period);
correctionPatch.set('adjustmentHours', '0.4');
await action('month-settings', correctionPatch);
const patchedPage = await pageData(zeroSource.period);
assert.equal(patchedPage.settlement.note, 'Separat gespeicherte Monatsnotiz');
assert.equal(patchedPage.settlement.adjustmentHours, 0.4);
assert.equal(patchedPage.settlement.paidBonus, null);
const paymentCheck = patchedPage.review.employerChecks.find(check => check.title.startsWith('Auszahlung: '));
assert.ok(paymentCheck);
assert.equal(paymentCheck.status, 'review');
const paymentAck = new FormData();
paymentAck.set('reportKey', patchedPage.review.reportKey);
paymentAck.set('checkKey', paymentCheck.key);
paymentAck.set('acknowledged', 'true');
await action('acknowledge', paymentAck);
assert.ok(
  (await pageData(zeroSource.period)).review.employerChecks.find(check => check.key === paymentCheck.key).acknowledgedAt
);
const nextSource = {
  ...zeroSource,
  period: '2025-08',
  totals: { actualHours: 8, contractualTarget: 8, plannedTarget: 8, closingBalance: 17.05 },
  wageTypes: { night: 7.5, nightTotal: 7.5 }
};
const nextImport = new FormData();
nextImport.set('report', JSON.stringify(nextSource));
await action('import', nextImport);
const nextPage = await pageData(nextSource.period);
assert.equal(
  nextPage.settlement.openingHours,
  17.05,
  'next month carries source closing instead of reapplying initial zero'
);
const nightSplit = nextPage.review.employerChecks.find(check => check.title === 'Nachtstunden: regulär + BD');
assert.equal(nightSplit.expected, 7.5);
assert.equal(nightSplit.status, 'ok');
for (const month of ['2026-11', '2026-12', '2027-01']) {
  const reference = {
    month,
    amounts: { timeBonus: month === '2027-01' ? 500 : 400, standby: 0, oncall: 0, plannedOvertime: 0, other: 0 },
    excludedAmount: 0,
    excludedDays: 0,
    source: 'Smoke reference payroll',
    sourceKey: '',
    confirmed: true
  };
  const form = new FormData();
  form.set('operation', 'reference');
  form.set('value', JSON.stringify(reference));
  assert.equal((await action('continued-pay', form)).type, 'success');
}
const sickPeriod = {
  id: 'smoke-continued-pay',
  start: '2027-02-01',
  end: '2027-02-05',
  days: ['2027-02-01', '2027-02-02', '2027-02-03', '2027-02-04', '2027-02-05'],
  workDaysPerWeek: 5,
  employmentStart: '',
  workTimeChange: '',
  divisorOverride: null,
  individualAmount: null,
  individualDays: null,
  adjustments: {},
  confirmed: true,
  note: 'Test only'
};
const sickForm = new FormData();
sickForm.set('operation', 'period');
sickForm.set('value', JSON.stringify(sickPeriod));
assert.equal((await action('continued-pay', sickForm)).type, 'success');
const sickPage = await pageData('2027-02');
assert.ok(sickPage.months.includes('2027-02') && sickPage.reviewMonths.includes('2027-02'));
assert.deepEqual(sickPage.continuedPay.periods.find(p => p.id === sickPeriod.id).days, sickPeriod.days);
const sickExport = await (await fetch(`${base}/api/export`, { headers: auth })).json();
assert.equal(sickExport.continuedPay.references.find(r => r.month === '2027-01').amounts.timeBonus, 500);
const sickHtml = await (await fetch(`${base}/?month=2027-02&tab=Monat`, { headers: auth })).text();
assert.ok(
  sickHtml.includes('100,00') && sickHtml.includes('Entgeltfortzahlung'),
  'continued pay reaches the monthly overview without diary entries or a report'
);
const overlapping = new FormData();
overlapping.set('operation', 'period');
overlapping.set('value', JSON.stringify({ ...sickPeriod, id: 'overlap' }));
assert.equal((await action('continued-pay', overlapping, 400)).type, 'failure');
assert.equal((await pageData('2027-02')).continuedPay.periods.filter(p => p.start.startsWith('2027-02')).length, 1);
console.log(
  'Production smoke OK: uploads, persistence, validation, CSRF, monthly arithmetic, payout acknowledgements, continued-pay actions, export and monthly overview.'
);
