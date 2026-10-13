/** Deterministic, entirely invented data for public README screenshots. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultRules, emptySettlement, validateEntry, validateRules, type Entry } from '../src/lib/model';
import { getHolidays } from '../src/lib/holidays';
import { emptyContinuedPay } from '../src/lib/continued-pay';
import { validateReport } from '../src/lib/validate-report';
import { auditReport } from '../src/lib/audit';
import type { ReportDay, TimeReport } from '../src/lib/report';

const directory = fileURLToPath(new URL('../docs/demo/', import.meta.url));
const round = (n: number) => Math.round(n * 100) / 100;
const rules = validateRules({
  ...structuredClone(defaultRules),
  group: '1',
  stage: 3,
  federalState: 'NW',
  confirmed: true,
  openingMonth: '2026-01',
  openingHours: 12,
  openingHoursEntered: true,
  holidayCompensated: true,
  optOut: 'no'
});
const holidays = new Set(getHolidays(2026, 'NW').map(day => day.date));
const reports: { report: TimeReport; importedAt: string }[] = [];
const entries: Entry[] = [];
const settlements = [];
let opening = rules.openingHours;

for (let month = 1; month <= 9; month++) {
  const period = `2026-${String(month).padStart(2, '0')}`;
  const length = new Date(Date.UTC(2026, month, 0)).getUTCDate();
  const dates = Array.from({ length }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`);
  const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
  const isWorkday = (date: string) => weekday(date) > 0 && weekday(date) < 6 && !holidays.has(date);
  const vacation = new Set(
    month === 8
      ? dates.filter(d => d >= '2026-08-10' && d <= '2026-08-14')
      : month === 9
        ? ['2026-09-24', '2026-09-25']
        : []
  );
  const sick = new Set(month === 9 ? ['2026-09-14', '2026-09-15', '2026-09-16'] : []);
  const available = dates.filter(d => isWorkday(d) && !vacation.has(d) && !sick.has(d));
  const bdDates = new Set([available[2], available[8], ...(month % 3 !== 0 ? [available[13]] : [])]);
  const fzaDate = month % 2 === 0 ? available[17] : undefined;
  const saturday = dates.filter(d => weekday(d) === 6)[month % 2];
  const sunday = dates.filter(d => weekday(d) === 0)[1];
  const days: ReportDay[] = dates.map((date, index) => {
    const day: ReportDay = {
      date,
      label: 'Frei',
      plannedHours: isWorkday(date) ? 8 : 0,
      actualHours: 0,
      overtimeHours: 0,
      standbyHours: 0,
      standbyWeightedHours: null,
      standbyCount: 0,
      nightHours: 0,
      saturdayHours: 0,
      sundayHours: 0,
      holidayHours: 0,
      spans: [],
      rawLines: []
    };
    if (sick.has(date) || vacation.has(date)) {
      day.label = sick.has(date) ? 'Krank' : 'Urlaub';
      day.actualHours = day.plannedHours;
    } else if (isWorkday(date) || date === saturday || date === sunday) {
      const late = isWorkday(date) && index % 8 === month % 8 && !bdDates.has(date);
      const extra = isWorkday(date) && index % 6 === month % 6 && !late ? ((month % 3) + 1) * 0.5 : 0;
      const start = date === saturday ? '13:00' : late ? '14:00' : '07:00';
      const end =
        date === saturday
          ? '21:30'
          : late
            ? '22:30'
            : extra === 0
              ? '15:30'
              : extra === 0.5
                ? '16:00'
                : extra === 1
                  ? '16:30'
                  : '17:00';
      day.label = late ? 'Spätdienst' : date === saturday || date === sunday ? 'Wochenenddienst' : 'Regeldienst';
      day.actualHours = 8 + extra;
      day.nightHours = date === saturday ? 1.5 : late ? 2.5 : 0;
      day.saturdayHours = date === saturday ? 8 : 0;
      day.sundayHours = date === sunday ? 8 : 0;
      day.spans.push({ start, end, label: day.label, kind: 'work', raw: `${day.label} ${start}-${end}, Pause 30 min` });
    }
    if (bdDates.has(date) || date === fzaDate) {
      const fza = date === fzaDate,
        label = fza ? 'BD-St.I-FZA' : 'BD-St.II-bez';
      day.standbyHours = 6;
      day.standbyWeightedHours = fza ? 3.6 : 5.7;
      day.standbyCount = 1;
      day.nightHours! += 3;
      day.spans.push({ start: '17:00', end: '23:00', label, kind: 'standby', raw: `${label} 17:00-23:00` });
    }
    day.rawLines = [
      `${date}: ${day.label}; Soll ${day.plannedHours} h; Ist ${day.actualHours} h`,
      ...day.spans.map(s => s.raw)
    ];
    return day;
  });
  const sum = (key: keyof ReportDay) =>
    round(days.reduce((n, d) => n + (typeof d[key] === 'number' ? (d[key] as number) : 0), 0));
  const actual = sum('actualHours'),
    target = sum('plannedHours');
  const fza = fzaDate ? 3.6 : 0,
    paidBd = round(bdDates.size * 5.7);
  const closing = round(opening + actual - target + fza);
  const overtime = Math.max(0, round(actual - target));
  const report = validateReport({
    period,
    printedAt: `2026-${String(month + 1).padStart(2, '0')}-02`,
    filename: `demo-zeitnachweis-${period}.txt`,
    days,
    totals: {
      actualHours: actual,
      contractualTarget: target,
      plannedTarget: target,
      openingBalance: opening,
      closingBalance: closing,
      monthlyBalance: round(actual - target),
      bdHours: sum('standbyHours'),
      bdCount: sum('standbyCount'),
      bdFactoredBuild: paidBd,
      bdFactoredDecrease: paidBd,
      bdFactoredTotal: 0
    },
    wageTypes: {
      night: round(sum('nightHours') - sum('standbyCount') * 3),
      nightStandby: sum('standbyCount') * 3,
      nightTotal: sum('nightHours'),
      saturday: sum('saturdayHours'),
      sunday: sum('sundayHours'),
      holiday35: 0,
      holiday135: 0,
      overtimeBonus: overtime,
      overtimeBase: 0
    },
    transfers: [],
    issues: [],
    warnings: [],
    rawText: `FIKTIVE DEMODATEN – frei erfunden, keine Beschäftigten- oder Arbeitgeberdaten.\nDienstmonat ${period}\n${days.flatMap(d => d.rawLines).join('\n')}`
  });
  const settlement = { ...emptySettlement(period), note: 'Fiktives Beispiel für öffentliche Screenshots.' };
  const audit = auditReport(
    report,
    rules,
    settlement,
    reports.map(r => r.report)
  );
  const differences = audit.checks.filter(c => !c.title.startsWith('Auszahlung: ') && c.status !== 'ok');
  if (differences.length) throw new Error(`${period}: ${differences.map(c => c.title).join(', ')}`);
  reports.push({ report, importedAt: `${report.printedAt}T10:00:00.000Z` });
  settlements.push(settlement);
  opening = closing;
}

// A small independent sample includes one deliberate 15-minute discrepancy.
for (const [date, end] of [
  ['2026-09-21', '15:30'],
  ['2026-09-22', '15:45']
] as const) {
  entries.push({
    ...validateEntry({
      date,
      start: '07:00',
      end,
      breakMinutes: 30,
      kind: 'work',
      note: 'Fiktive eigene Zeitaufzeichnung',
      meta: { pauseStart: '12:00' }
    }),
    id: entries.length + 1,
    source: 'Fiktive Demodaten'
  });
}
const backup = {
  version: 1,
  exportedAt: '2026-10-02T10:00:00.000Z',
  rules,
  entries,
  settlements,
  reports,
  pendingReports: [],
  pendingEntryImports: [],
  acknowledgements: [],
  continuedPay: emptyContinuedPay()
};
mkdirSync(directory, { recursive: true });
writeFileSync(`${directory}/zeitklar-demo.json`, JSON.stringify(backup, null, 2) + '\n');
console.log(
  `Demo erstellt: ${reports.length} Nachweise, ${entries.length} eigene Einträge. Alle Arbeitgeber-Stundenprüfungen sind stimmig.`
);
