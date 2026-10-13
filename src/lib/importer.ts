import { validateEntry, type Entry } from './model';
import type { ReportDay, TimeReport } from './report';
import { hasSickness, hasPlannedFree, hasVacation } from './absence';
export type Parsed = { entries: Entry[]; warnings: string[]; text: string; filename: string; report?: TimeReport };

const number = (value: string): number | null => {
  const match = value.trim().match(/^(-?)(\d+(?:\.\d{3})*,\d+)(-?)$/);
  return match ? Number(match[2].replaceAll('.', '').replace(',', '.')) * (match[1] || match[3] ? -1 : 1) : null;
};
const isoDate = (date: string) => date.split('.').reverse().join('-');
const validDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const grid = (line: string) => line.replace(/^\|/, '').replaceAll('|', ' ');
const totalLabels: Record<string, string> = {
  openingBalance: 'Guthaben Alt',
  actualHours: 'Istzeit',
  contractualTarget: 'vertragl.monatl.Sollzeit',
  plannedTarget: 'geplante Sollzeit',
  closingBalance: 'Guthaben Neu',
  monthlyBalance: 'Jahresarb.zeitkonto/Monat',
  bdCountI: 'BD_Anzahl_in_Stufe_I (TVÄ)',
  bdCountII: 'BD_Anzahl_in_Stufe_II(TVÄ)',
  bdHoursI: 'BD_Std._in_Stufe_I   (TVÄ)',
  bdHoursII: 'BD_Std._in_Stufe_II  (TVÄ)',
  bdFactoredBuild: 'fakt.BD Monat Aufbau (TVÄ)',
  bdFactoredTotal: 'fakt.BD Monat ges.   (TVÄ)',
  healthHours: 'Arbeitsschutzkonto/Monat',
  holidayBalance: 'Freizeitkonto Feiertagsarb',
  optOut: 'Opt-Out',
  fullTimeTarget: 'monatl. Vollzeit',
  bdFactoredDecrease: 'fakt.BD Monat Abbau  (TVÄ)',
  annualBalance: 'Jahresarbeitszeitkonto',
  bdPreviousTransfer: 'fakt.BD Vorm. Übertr (TVÄ)',
  bdPreviousDecrease: 'fakt.BD Vorm. Abbau  (TVÄ)',
  bdPreviousTotal: 'fakt.BD Vorm. ges.   (TVÄ)'
};

/** DPL statements are employer-reported figures, never silently converted into independent shifts. */
function parseDpl(text: string, filename: string): TimeReport {
  const rawLines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const lines = rawLines.map(grid);
  const periodLine = lines.find(line => /Abr\.periode/.test(line)) ?? '';
  const periodDates = [...periodLine.matchAll(/\b\d{2}\.\d{2}\.\d{4}\b/g)].map(match => isoDate(match[0]));
  if (
    periodDates.length !== 2 ||
    !periodDates.every(validDate) ||
    periodDates[0] > periodDates[1] ||
    periodDates[0].slice(0, 7) !== periodDates[1].slice(0, 7)
  ) {
    throw new Error(
      'Die DPL-Abrechnungsperiode konnte nicht als einzelner Monat erkannt werden. Originalexport prüfen.'
    );
  }
  const period = periodDates[0].slice(0, 7);
  const printed = lines.find(line => /gedruckt_am/.test(line))?.match(/\d{2}\.\d{2}\.\d{4}/)?.[0];
  const warnings = [
    'Die Werte stammen aus dem Zeitnachweis des Arbeitgebers. Für einen unabhängigen Abgleich können eigene Dienste erfasst werden.',
    'Pausenlage und die zeitliche Zuordnung von Freizeitausgleich/Bereitschaftsdienst sind im Export nicht vollständig dokumentiert. Unklare Zeitspannen bleiben ungeklärt.'
  ];
  if (!printed || !validDate(isoDate(printed)))
    warnings.push('Das Druckdatum fehlt oder ist ungültig im Zeitnachweis.');
  const report: TimeReport = {
    period,
    printedAt: printed && validDate(isoDate(printed)) ? isoDate(printed) : '',
    filename,
    days: [],
    totals: {},
    wageTypes: {},
    transfers: [],
    issues: [],
    warnings,
    rawText: text
  };
  let section: 'none' | 'days' | 'totals' | 'wages' | 'other' | 'transfers' | 'issues' = 'none';
  let current: ReportDay | undefined;
  let wageGroup: 'first' | 'night' | undefined;
  let errorColumn = 40;
  let tableHeader = false;
  for (const [index, line] of lines.entries()) {
    if (/Einzelergebnisse/.test(line)) {
      section = 'days';
      continue;
    }
    if (/Summenübersicht Lohnarten/.test(line)) {
      section = 'wages';
      current = undefined;
      continue;
    }
    if (/Summenübersicht/.test(line)) {
      section = 'totals';
      current = undefined;
      continue;
    }
    if (/Urlaubsansprüche/.test(line)) {
      section = 'other';
      continue;
    }
    if (/Zeitumbuchungen/.test(line)) {
      section = 'transfers';
      continue;
    }
    if (/Zeitauswertungsfehler/.test(line)) {
      section = 'issues';
      continue;
    }
    if (section === 'days') {
      if (/^Tg\s+Text/.test(line)) {
        tableHeader = /^Tg\s+Text/.test(line) && line.indexOf('Nacht') === 102;
        continue;
      }
      if (!line.trim() || /^[-\s]+$/.test(line)) continue;
      const dayNumber = line.match(/^(\d{2})\s/);
      if (dayNumber) {
        const date = `${period}-${dayNumber[1]}`;
        if (date < periodDates[0] || date > periodDates[1]) {
          warnings.push(`Ungültiger Tag im Zeitnachweis: ${dayNumber[1]}.`);
          current = undefined;
          continue;
        }
        current = report.days.find(day => day.date === date);
        if (!current) {
          current = {
            date,
            label: line.slice(3, 22).trim(),
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
            rawLines: []
          };
          report.days.push(current);
        } else warnings.push(`Tag ${dayNumber[1]} erscheint mehrfach; die Quellzeilen wurden zusammengeführt.`);
      }
      if (!current) continue;
      current.rawLines.push(rawLines[index]);
      if (!tableHeader) continue;
      const add = (
        key: keyof Pick<
          ReportDay,
          | 'plannedHours'
          | 'actualHours'
          | 'overtimeHours'
          | 'standbyHours'
          | 'standbyWeightedHours'
          | 'standbyCount'
          | 'nightHours'
          | 'saturdayHours'
          | 'sundayHours'
          | 'holidayHours'
        >,
        start: number,
        end: number
      ) => {
        const value = number(line.slice(start, end));
        if (value !== null) current![key] = Math.round(((current![key] ?? 0) + value) * 100) / 100;
      };
      add('plannedHours', 47, 54);
      add('actualHours', 54, 61);
      add('overtimeHours', 61, 68);
      const clocks = [...line.slice(22, 45).matchAll(/\b\d{2}:\d{2}\b/g)].map(match => match[0]);
      // A numeric continuation without clocks is the weighted BD amount printed beneath its duration.
      add(clocks.length ? 'standbyHours' : 'standbyWeightedHours', 71, 78);
      add('standbyCount', 78, 85);
      add('nightHours', 102, 109);
      add('saturdayHours', 109, 116);
      add('sundayHours', 116, 123);
      add('holidayHours', 123, 130);
      if (clocks.length === 2) {
        const label = line.slice(3, 22).match(/\bBD-\S+/)?.[0] ?? (line.slice(3, 22).trim() || current.label);
        const ambiguous = /FZA/i.test(current.label);
        current.spans.push({
          start: clocks[0],
          end: clocks[1],
          label,
          kind: ambiguous ? 'unknown' : /BD-St\./i.test(label) ? 'standby' : 'work',
          raw: rawLines[index]
        });
      }
    } else if (section === 'totals') {
      for (const [key, label] of Object.entries(totalLabels)) {
        const pattern = label
          .trim()
          .split(/\s+/)
          .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('\\s+');
        const match = line.match(new RegExp(`(?:^|\\s)${pattern}\\s+(-?\\d+(?:\\.\\d{3})*,\\d+-?)?(?=\\s|$)`));
        if (match) report.totals[key] = match[1] ? number(match[1]) : null;
      }
    } else if (section === 'wages') {
      if (/^FT\s*35%/.test(line)) {
        wageGroup = 'first';
        continue;
      }
      if (/^Nacht\s+Nacht/.test(line)) {
        wageGroup = 'night';
        continue;
      }
      if (!wageGroup || !/\d+,\d+/.test(line) || /[A-Za-zÄäÖöÜü]/.test(line)) continue;
      const firstFields = {
        holiday35: [0, 8],
        holiday100: [8, 16],
        holiday135: [16, 24],
        saturday: [24, 32],
        sunday: [32, 40],
        overtimeBase: [40, 48],
        overtimeBonus: [48, 56],
        shiftAllowance: [64, 74]
      };
      const nightFields = { night: [0, 8], nightStandby: [8, 16], nightTotal: [16, 24] };
      for (const [key, [start, end]] of Object.entries(wageGroup === 'first' ? firstFields : nightFields))
        report.wageTypes[key] = number(line.slice(start, end));
      wageGroup = undefined;
    } else if (section === 'transfers') {
      const match = line.match(/^(\d{2}\.\d{2}\.\d{4})\s+(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+(-?\d+,\d+-?)\s*$/);
      if (match) report.transfers.push({ date: isoDate(match[1]), label: match[3].trim(), hours: number(match[4])! });
    } else if (section === 'issues') {
      if (/^Datum\s/.test(line)) {
        errorColumn = line.match(/\bFehler\b/)?.index ?? 40;
        continue;
      }
      const date = line.match(/^(\d{2}\.\d{2}\.\d{4})/);
      if (date)
        report.issues.push({ date: isoDate(date[1]), message: line.slice(errorColumn, errorColumn + 34).trim() });
    }
  }
  for (const key of Object.keys(totalLabels)) report.totals[key] ??= null;
  for (const key of ['bdCount', 'bdHours']) {
    const first = report.totals[`${key}I`],
      second = report.totals[`${key}II`];
    report.totals[key] =
      first === null && second === null ? null : Math.round(((first ?? 0) + (second ?? 0)) * 100) / 100;
  }
  for (const key of [
    'night',
    'nightStandby',
    'nightTotal',
    'saturday',
    'sunday',
    'holiday35',
    'holiday100',
    'holiday135',
    'overtimeBase',
    'overtimeBonus',
    'shiftAllowance'
  ])
    report.wageTypes[key] ??= null;
  if (!tableHeader)
    warnings.push(
      'Die DPL-Tagesstruktur weicht vom unterstützten Spaltenlayout ab; Tagesbeträge wurden nicht zugeordnet. Rohdaten prüfen.'
    );
  if (report.days.length !== Number(periodDates[1].slice(-2)) - Number(periodDates[0].slice(-2)) + 1)
    warnings.push('Die Tagesliste ist unvollständig. Quelltext und Originaldatei prüfen.');
  if (report.totals.actualHours === null || report.totals.contractualTarget === null)
    warnings.push('Wesentliche Monatssummen fehlen oder wurden nicht erkannt.');
  return report;
}
export function parseText(text: string, filename = 'Texteingabe'): Parsed {
  if (/Zeitnachweisliste/.test(text) && /Abr\.periode/.test(text)) {
    const report = parseDpl(text, filename);
    return { entries: [], warnings: report.warnings, text, filename, report };
  }
  const entries: Entry[] = [],
    warnings: string[] = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const match = line.match(/\b(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})\b/);
    if (!match) {
      warnings.push(`Zeile ${index + 1}: Kein vollständiges Datum erkannt — ${line.trim().slice(0, 120)}`);
      continue;
    }
    const date = match[0].includes('.') ? match[0].split('.').reverse().join('-') : match[0];
    const rest = line.slice((match.index ?? 0) + match[0].length);
    const kind = /\burlaub\b/i.test(rest) ? 'vacation' : hasSickness(rest) ? 'sick' : 'work';
    const times = [...rest.matchAll(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g)];
    let breakMinutes = 0;
    if (kind === 'work') {
      if (times.length < 2) {
        warnings.push(`Zeile ${index + 1}: Beginn und Ende fehlen — bitte manuell erfassen.`);
        continue;
      }
      const after = rest.slice((times[1].index ?? 0) + times[1][0].length).trim();
      const pause = after.match(
        /^(?:\s*[;|,]\s*|\s+)?(?:Pause\s*[:=]?\s*)?(\d{1,3}(?::\d{2})?)(?:\s*(?:min|Minuten))?(?=\s|[;|,]|$)/i
      );
      if (pause) {
        const p = pause[1].split(':').map(Number);
        breakMinutes = p.length === 2 ? p[0] * 60 + p[1] : p[0];
      } else warnings.push(`Zeile ${index + 1}: Pause nicht erkannt; vor dem Speichern prüfen (aktuell 0 Minuten).`);
      if (times.length > 3)
        warnings.push(
          `Zeile ${index + 1}: Weitere Uhrzeiten vorhanden. Nur die ersten beiden wurden als Schicht erkannt.`
        );
    }
    const meta =
      kind === 'sick' && hasPlannedFree(rest)
        ? { sickPayEligible: false }
        : kind === 'vacation' && (hasPlannedFree(rest) || !hasVacation(rest))
          ? { vacationPayEligible: false }
          : {};
    try {
      entries.push(
        validateEntry({
          date,
          start: times[0]?.[0].padStart(5, '0') ?? '',
          end: times[1]?.[0].padStart(5, '0') ?? '',
          breakMinutes,
          kind,
          note: '',
          meta
        })
      );
    } catch (e) {
      warnings.push(`Zeile ${index + 1}: ${(e as Error).message}`);
    }
  }
  return { entries, warnings, text: text.slice(0, 100000), filename };
}
