// Capture the real browser app in a fresh, disposable browser context.
// Requires a separate installation of Playwright; see docs/demo/README.md.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.env.DEMO_BASE_URL || 'http://127.0.0.1:5175';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Use a local demo server.');
const fixture = fileURLToPath(new URL('../docs/demo/zeitklar-demo.json', import.meta.url));
const output = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
const mock = JSON.parse(await readFile(fixture, 'utf8'));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.DEMO_BROWSER_CHANNEL ? { channel: process.env.DEMO_BROWSER_CHANNEL } : {})
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    colorScheme: 'light'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?month=2026-09`);
  await page.getByRole('heading', { name: 'Jahresübersicht 2026', exact: true }).waitFor();
  await page.locator('.local-banner input[type=file]').setInputFiles(fixture);
  await page.getByRole('status').filter({ hasText: '9 Nachweise hinzugefügt' }).waitFor();
  const restored = await page.evaluate(async () => {
    const { readSnapshot } = await import('/store.ts');
    return await readSnapshot();
  });
  assert.equal(restored.reports.length, mock.reports.length);
  assert.equal(restored.entries.length, mock.entries.length);
  assert.deepEqual(
    restored.reports.map(r => r.report),
    mock.reports.map(r => r.report)
  );
  // Reload dismisses the transient import notice through the normal app lifecycle.
  await page.reload();
  await page.getByRole('heading', { name: 'Jahresübersicht 2026', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const composition = await page.locator('section.composition').boundingBox();
  await page.setViewportSize({ width: 1440, height: Math.ceil(composition.y + composition.height + 24) });
  await page.screenshot({ path: `${output}/jahresuebersicht.png`, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('navigation').getByRole('button', { name: 'Monat', exact: true }).click();
  await page.getByRole('heading', { name: 'September 2026', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/monatsuebersicht.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('navigation').getByRole('button', { name: 'Kalender', exact: true }).click();
  await page.locator('.calendar-grid').waitFor();
  const calendar = await page.locator('.calendar-panel').boundingBox();
  await page.setViewportSize({ width: 1440, height: Math.ceil(calendar.y + calendar.height + 24) });
  await page.screenshot({ path: `${output}/kalender.png`, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Abgleich/ })
    .click();
  const checks = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Prüfung des Dienstmonats', exact: true }) });
  await checks.waitFor();
  await checks.screenshot({ path: `${output}/stundenabgleich.png`, animations: 'disabled' });
  const pay = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Vergütung', exact: true }) });
  for (const details of await pay.locator('details[open]').all()) await details.locator('summary').click();
  await pay.screenshot({ path: `${output}/verguetung.png`, animations: 'disabled' });
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('5 Screenshots erstellt; Demoimport und Browseransichten ohne Laufzeitfehler geprüft.');
} finally {
  await browser.close();
}
