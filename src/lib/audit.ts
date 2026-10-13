import { calculate, hasClockChange, percentageRate } from './calculate';
import { tariffProfile } from './tariff';
import { rulesAt, durationMinutes, emptySettlement, minute, type Entry, type Rules, type Settlement } from './model';
import { effectiveHolidays } from './holidays';
import { holidayAccountCheck } from './holiday-account';
import { standbyCompensation, standbyTimeCredit } from './standby-credit';
import { isStandbyPayout, standbyAccountChecks } from './standby-account';
import type { AuditCheck, EmployerHoursSummary, ReportAudit, ReportDay, TimeReport } from './report';

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const present = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const show = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const blankOvertimeClaim = (report: TimeReport) =>
  Object.hasOwn(report.wageTypes, 'overtimeBonus') && report.wageTypes.overtimeBonus === null;

/** Derive a complete arithmetic basis; source gaps stay explicit and source values stay untouched. */
export function getEmployerHours(report: TimeReport, timeline: Rules, settlement: Settlement): EmployerHoursSummary {
  const rules = rulesAt(timeline, report.period);
  const assumptions: string[] = [];
  const evidence: EmployerHoursSummary['evidence'] = {
    actualHours: 'report',
    contractualTarget: 'report',
    plannedTarget: 'report',
    openingBalance: 'report',
    adjustmentHours: 'settlement'
  };
  const [year, month] = report.period.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const completeDays =
    report.days.length === daysInMonth &&
    new Set(report.days.map(day => day.date)).size === daysInMonth &&
    report.days.every(day => day.date.startsWith(report.period + '-'));
  const knownActual = report.days.map(day => day.actualHours).filter(present);
  const knownPlanned = report.days.map(day => day.plannedHours).filter(present);
  const dayActual = round(knownActual.reduce((n, value) => n + value, 0));
  const dayPlanned = round(knownPlanned.reduce((n, value) => n + value, 0));

  let openingBalance = report.totals.openingBalance;
  if (!present(openingBalance)) {
    openingBalance = present(settlement.openingHours) ? settlement.openingHours : 0;
    const entered = settlement.openingHoursEntered === true || openingBalance !== 0;
    evidence.openingBalance = entered ? 'settlement' : 'assumption';
    assumptions.push(
      entered
        ? settlement.openingHoursOrigin === 'initial'
          ? `Anfangsguthaben fehlt im Nachweis; einmaliger Anfangsstand aus den Einstellungen ${show(openingBalance)} h wird verwendet.`
          : settlement.openingHoursOrigin === 'previous'
            ? `Anfangsguthaben fehlt im Nachweis; Endstand des Vormonats ${show(openingBalance)} h wird als Anfangsstand übernommen.`
            : settlement.openingHoursOrigin === 'personal'
              ? `Anfangsguthaben fehlt im Nachweis; vorläufiger Endstand aus eigenen Zeitaufzeichnungen des Vormonats ${show(openingBalance)} h wird übernommen.`
              : `Anfangsguthaben fehlt im Nachweis; deine gespeicherte Monatseingabe ${show(openingBalance)} h wird als Anfangsstand verwendet.`
        : `Anfangsguthaben fehlt im Nachweis; vorläufig ${show(openingBalance)} h als Anfangsstand angenommen (Standardwert 0 h, noch keine Monatseingabe gespeichert).`
    );
    if (settlement.openingHoursGap) assumptions.push(`Anfangsguthaben: ${settlement.openingHoursGap}`);
  }
  let actualHours = report.totals.actualHours;
  if (!present(actualHours)) {
    if (present(settlement.recordedHours)) {
      actualHours = settlement.recordedHours;
      evidence.actualHours = 'settlement';
      assumptions.push(
        `Istzeit fehlt in der Monatssumme; gespeicherte Monatsangabe ${show(actualHours)} h wird verwendet.`
      );
    } else if (knownActual.length) {
      actualHours = dayActual;
      evidence.actualHours = 'days';
      assumptions.push(
        `Istzeit fehlt in der Monatssumme; Summe der ${knownActual.length} bekannten Tages-Istwerte: ${show(actualHours)} h. ${completeDays ? 'Nicht ausgewiesene Istwerte werden vorläufig als 0 h behandelt.' : `Tagesliste nur ${report.days.length}/${daysInMonth} Tage: Teil-/Mindestwert, fehlende Zeiten können die Monatssumme erhöhen.`}`
      );
    } else {
      actualHours = 0;
      evidence.actualHours = 'assumption';
      assumptions.push(
        'Istzeit fehlt im Nachweis und in den Monatsangaben; vorläufig 0 h angenommen. Die tatsächliche Monatsarbeitszeit ist unbekannt.'
      );
    }
  }
  let contractualTarget = report.totals.contractualTarget;
  if (!present(contractualTarget)) {
    if (present(settlement.targetHours)) {
      contractualTarget = settlement.targetHours;
      evidence.contractualTarget = 'settlement';
      assumptions.push(
        `Vertragliches Soll fehlt im Nachweis; gespeicherte Sollzeit ${show(contractualTarget)} h wird verwendet.`
      );
    } else {
      contractualTarget = round(calculate([], rules, report.period, emptySettlement(report.period)).target);
      evidence.contractualTarget = 'profile';
      assumptions.push(
        `Vertragliches Soll fehlt im Nachweis; aus dem Profil für ${report.period} berechnet: ${show(contractualTarget)} h${!rules.confirmed ? ' (Profil noch nicht bestätigt)' : ''}${!rules.federalState ? ' (Bundesland fehlt, Feiertage können unvollständig sein)' : ''}.`
      );
    }
  }
  let plannedTarget = report.totals.plannedTarget;
  if (!present(plannedTarget)) {
    if (completeDays && knownPlanned.length) {
      plannedTarget = dayPlanned;
      evidence.plannedTarget = 'days';
      assumptions.push(
        `Geplante Sollzeit fehlt in der Monatssumme; vollständige Tagesliste, Summe der ${knownPlanned.length} bekannten Sollwerte: ${show(plannedTarget)} h. Nicht ausgewiesene Sollwerte werden vorläufig als 0 h behandelt.`
      );
    } else {
      plannedTarget = contractualTarget;
      evidence.plannedTarget = 'assumption';
      assumptions.push(
        `Geplante Sollzeit fehlt in der Monatssumme; vorläufig wie Vertragssoll ${show(plannedTarget)} h angenommen.${knownPlanned.length ? ` Teil-Tagesliste ${report.days.length}/${daysInMonth} mit ${show(dayPlanned)} h erkannt; diese Teilsumme gilt nicht als Monatssoll.` : ' Kein vollständiges Tages-Soll verfügbar.'}`
      );
    }
  }
  const adjustmentHours = present(settlement.adjustmentHours) ? settlement.adjustmentHours : 0;
  if (!present(settlement.adjustmentHours))
    assumptions.push('Korrektur fehlt in den Monatsangaben; vorläufig 0 h angenommen.');
  const monthlyDelta = round(actualHours - contractualTarget),
    plannedDelta = round(actualHours - plannedTarget);
  const overtimeBasis = Math.max(0, round(actualHours - Math.max(plannedTarget, contractualTarget)));
  const standbyCredit = standbyTimeCredit(report);
  if (standbyCredit.unresolvedDates.length)
    assumptions.push(
      `BD-FZA-Zugang unvollständig: ${standbyCredit.unresolvedDates.join(', ')}. Bewertete Stunden fehlen oder bezahlte und FZA-Dienste sind im Tageswert vermischt; Kontenzuordnung prüfen.`
    );
  return {
    actualHours,
    contractualTarget,
    plannedTarget,
    openingBalance,
    adjustmentHours,
    standbyCredit,
    monthlyDelta,
    plannedDelta,
    computedClosingBalance: round(openingBalance + monthlyDelta + standbyCredit.hours + adjustmentHours),
    overtimeBasis,
    reportedOvertimeHours: present(report.wageTypes.overtimeBonus)
      ? report.wageTypes.overtimeBonus
      : blankOvertimeClaim(report)
        ? 0
        : null,
    assumptions,
    evidence
  };
}

/** Checks consistency of employer claims. It does not reconstruct duties or certify payment. */
export function auditReport(
  report: TimeReport,
  timeline: Rules,
  settlement: Settlement,
  reports: TimeReport[] = []
): ReportAudit {
  const rules = rulesAt(timeline, report.period);
  const checks: AuditCheck[] = [];
  const information: TimeReport['issues'] = [];
  const payLines: ReportAudit['payLines'] = [];
  const warnings = [...report.warnings];
  const hoursSummary = getEmployerHours(report, rules, settlement);
  warnings.push(...hoursSummary.assumptions);
  if (!rules.federalState)
    warnings.push('Bundesland fehlt: Feiertage und damit Zuschlagsbewertungen sind unvollständig.');
  const total = (key: string) => (present(report.totals[key]) ? (report.totals[key] as number) : null);
  const wage = (key: string) => (present(report.wageTypes[key]) ? (report.wageTypes[key] as number) : null);
  const sum = (key: keyof ReportDay) => {
    const values = report.days.map(day => day[key]).filter(present);
    return values.length ? round(values.reduce((a, b) => a + b, 0)) : null;
  };
  function check(
    title: string,
    expected: number | null,
    reported: number | null,
    detail: string,
    unit: AuditCheck['unit'] = 'h',
    uncertain = false
  ) {
    checks.push({
      title,
      expected,
      reported,
      unit,
      detail,
      status:
        expected === null || reported === null || uncertain
          ? 'review'
          : Math.abs(expected - reported) <= 0.011
            ? 'ok'
            : 'difference'
    });
  }
  check(
    'Istzeit: Tageswerte / Monatssumme',
    sum('actualHours'),
    total('actualHours'),
    'Summe der ausgewiesenen Tages-Istzeiten; keine unabhängige Anwesenheitsberechnung.'
  );
  check(
    'Geplante Sollzeit: Tageswerte / Monatssumme',
    sum('plannedHours'),
    total('plannedTarget'),
    'Die vertragliche Sollzeit kann vom konkreten Dienstplan abweichen.'
  );
  check(
    'BD-Dauer: Tageswerte / Monatssumme',
    sum('standbyHours'),
    total('bdHours'),
    'Ungewichtete, vom Arbeitgeber ausgewiesene Bereitschaftsdienststunden.'
  );
  check(
    'BD-Anzahl: Tageswerte / Monatssumme',
    sum('standbyCount'),
    total('bdCount'),
    'Ausgewiesene BD-Anzahlen; nicht aus verschachtelten Uhrzeiten abgeleitet.',
    'count'
  );
  check(
    'Nachtstunden: Tageswerte / Lohnart',
    sum('nightHours'),
    wage('nightTotal'),
    'Die Tageswerte enthalten reguläre Nachtarbeit und Nachtarbeit im BD.'
  );
  const regularNight = wage('night'),
    standbyNight = wage('nightStandby');
  check(
    'Nachtstunden: regulär + BD',
    regularNight !== null ? round(regularNight + (standbyNight ?? 0)) : null,
    wage('nightTotal'),
    'Abgleich der drei Arbeitgeber-Lohnarten.' +
      (regularNight !== null && standbyNight === null
        ? ' BD-Nachtstunden sind nicht ausgewiesen; für diese Summe werden 0 h aus BD angesetzt.'
        : regularNight === null
          ? ' Reguläre Nachtstunden sind nicht ausgewiesen; die Summe bleibt unbekannt.'
          : '')
  );
  check(
    'Samstagsstunden: Tageswerte / Lohnart',
    sum('saturdayHours'),
    wage('saturday'),
    'Nur ausgewiesene Samstags-Zuschlagsstunden werden verglichen.'
  );
  if (sum('sundayHours') !== null || wage('sunday') !== null)
    check(
      'Sonntagsstunden: Tageswerte / Lohnart',
      sum('sundayHours'),
      wage('sunday'),
      'Abgleich der ausgewiesenen Sonntags-Zuschlagsstunden.'
    );
  for (const day of report.days) {
    if (!present(day.standbyHours) || !present(day.standbyWeightedHours)) continue;
    const source = [day.label, ...day.rawLines, ...day.spans.map(s => s.raw)].join(' ');
    const level = /(?:St\.?\s*II|Stufe[_\s]*II)(?!I)/i.test(source)
      ? 95
      : /(?:St\.?\s*I|Stufe[_\s]*I)(?!I)/i.test(source)
        ? 60
        : null;
    const holiday = effectiveHolidays(rules, Number(day.date.slice(0, 4))).includes(day.date);
    check(
      `${day.date}: BD-Grundbewertung`,
      level === null ? null : round((day.standbyHours * level) / 100),
      round(day.standbyWeightedHours),
      `Ausgewiesene BD-Dauer × ${level ?? 'ungeklärte'} %. Feiertags- und weitere Zusatzpunkte sowie der genaue Beginn des BD müssen separat bestätigt werden.`,
      'h',
      holiday || !rules.tariff
    );
    const category = standbyCompensation(day);
    checks[checks.length - 1].bdCategory = category;
    checks[checks.length - 1].detail =
      `${category === 'fza' ? 'Freizeitausgleich / Zugang zum Zeitkonto.' : category === 'paid' ? 'Auszahlung / Zugang zum BD-Auszahlungskonto.' : 'BD-Ausgleich ungeklärt.'} ${checks[checks.length - 1].detail}`;
  }
  const {
    openingBalance: opening,
    actualHours: actual,
    contractualTarget: target,
    adjustmentHours,
    computedClosingBalance: baseBalance
  } = hoursSummary;
  const closing = total('closingBalance');
  const balanceGap = closing !== null ? round(closing - baseBalance) : null;
  const assumptionsFor = (prefixes: string[]) =>
    hoursSummary.assumptions.filter(value => prefixes.some(prefix => value.startsWith(prefix))).join(' ');
  const bdCredit = hoursSummary.standbyCredit;
  const hasBdCredit = bdCredit.days.length > 0 || bdCredit.unresolvedDates.length > 0;
  const creditDetail = bdCredit.days.length
    ? `BD-FZA-Zugang aus den bewerteten Nachweis-Tageswerten: ${bdCredit.days.map(day => `${day.date}: ${show(day.hours)} h`).join(' + ')} = ${show(bdCredit.hours)} h. Bezahlte BD und das separate faktorisierte BD-Konto werden hier nicht zusätzlich angerechnet. `
    : '';
  check(
    hasBdCredit
      ? 'Zeitkonto: Anfang + Ist + BD-FZA − Vertragssoll + Korrektur'
      : 'Zeitkonto: Anfang + Ist − Vertragssoll + Korrektur',
    baseBalance,
    closing,
    `${show(opening)} + ${show(actual)}${hasBdCredit ? ` + ${show(bdCredit.hours)} BD-FZA` : ''} − ${show(target)} + ${show(adjustmentHours)} = ${show(baseBalance)} h. ` +
      creditDetail +
      (balanceGap !== null && Math.abs(balanceGap) > 0.011
        ? `Für den ausgewiesenen Endstand verbleibt eine Differenz von ${show(balanceGap)} h. Weitere Kontobuchungen und Umbuchungen prüfen.`
        : 'Rechnerischer Kontenabgleich; zugrunde liegende Buchungen sind damit nicht unabhängig bestätigt.') +
      ' ' +
      assumptionsFor(['Anfangsguthaben', 'Istzeit', 'Vertragliches Soll', 'Korrektur', 'BD-FZA']),
    'h',
    bdCredit.unresolvedDates.length > 0
  );
  check(
    'Monatssaldo: Ist − Vertragssoll',
    hoursSummary.monthlyDelta,
    total('monthlyBalance'),
    `${show(actual)} − ${show(target)} = ${show(hoursSummary.monthlyDelta)} h. Rechnerischer Monatssaldo; daraus folgt kein tariflicher Überstundenanspruch. ` +
      assumptionsFor(['Istzeit', 'Vertragliches Soll']),
    'h'
  );
  const higherTarget = Math.max(hoursSummary.plannedTarget, target);
  const overtimeDelta = round(actual - higherTarget);
  check(
    'Überstundenbasis: Ist − max(Plan; Vertrag)',
    hoursSummary.overtimeBasis,
    hoursSummary.reportedOvertimeHours,
    `${show(actual)} − max(${show(hoursSummary.plannedTarget)}; ${show(target)}) = ${show(overtimeDelta)} h. Geplantes Soll ${show(hoursSummary.plannedTarget)} h, Vertragssoll ${show(target)} h; verwendet wird die höhere Sollzeit ${show(higherTarget)} h. Positive Überstundenbasis: ${show(hoursSummary.overtimeBasis)} h.${overtimeDelta < 0 ? ' Eine negative Differenz ergibt keine negativen Zuschlagsstunden; die Basis beträgt 0 h.' : ''} Vergleich mit der Lohnart Überstundenzuschlag.${blankOvertimeClaim(report) ? " Die vorhandene leere Lohnart '-' / nicht ausgewiesen wird für diesen Abgleich als 0 h behandelt." : ''} Die Differenz allein bestätigt keinen tariflichen Überstundenanspruch. ` +
      assumptionsFor(['Istzeit', 'Geplante Sollzeit', 'Vertragliches Soll']),
    'h'
  );
  checks.push(...standbyAccountChecks(report));
  const holidayAccount = holidayAccountCheck(report, rules, reports);
  if (holidayAccount) checks.push(holidayAccount);
  for (const transfer of report.transfers.filter(item => !isStandbyPayout(item.label)))
    check(
      `Umbuchung ${transfer.date}: ${transfer.label}`,
      null,
      transfer.hours,
      'Die Quelldatei enthält diese Umbuchung. Zugehöriges Konto und Ursprungsmonat müssen anhand der Buchungen geprüft werden.'
    );
  for (const issue of report.issues) {
    information.push({ ...issue });
  }

  const profile = tariffProfile(rules, report.period);
  warnings.push(...profile.warnings);
  const rate = profile.bonusRate ?? 0;
  const knownTable = profile.bonusRate !== null;
  const changingRateWithinMonth =
    rules.tariff &&
    rules.workTimeChangeEnabled &&
    rules.workTimeChangeDate?.startsWith(report.period + '-') &&
    rules.workTimeChangeDate.slice(8) !== '01' &&
    (rules.weeklyHoursBefore ?? 42) !== (rules.weeklyHoursAfter ?? 40);
  if (changingRateWithinMonth)
    warnings.push(
      'Arbeitszeitänderung innerhalb des Monats: Lohnartstunden sind nicht nach Datum aufgeteilt. Stundenwerte am Monatsbeginn werden als Beispiel gezeigt; ein Gesamtbetrag kann ohne Zuordnung nicht geschätzt werden.'
    );
  if (!rules.confirmed)
    warnings.push('Profil noch nicht bestätigt: Entgeltgruppe und Stundenentgelte vor Bewertung der Schätzung prüfen.');
  if (!knownTable)
    warnings.push('Für den Leistungsmonat fehlt die passende Entgelttabelle. Es wird kein Betrag geschätzt.');
  const basis = `Schätzung auf Basis ausgewiesener Arbeitgeberstunden, Leistungsmonat ${report.period}; keine Zahlungsbestätigung.`;
  function pay(label: string, key: string, percent: number) {
    const amountHours = wage(key);
    if (!knownTable || amountHours === null || amountHours === 0 || !rate) return;
    const unitRate = percentageRate(rate, percent);
    payLines.push({ label, hours: amountHours, rate: unitRate, amount: round(amountHours * unitRate), basis });
  }
  pay('Nachtarbeit regulär', 'night', rules.tariff ? 20 : rules.nightPercent);
  pay('Nachtarbeit Bereitschaftsdienst', 'nightStandby', rules.tariff ? 20 : rules.nightPercent);
  const paidStandby = standbyTimeCredit(report, 'paid');
  if (knownTable && paidStandby.hours > 0 && profile.individualRate && !changingRateWithinMonth)
    payLines.push({
      label: 'Bereitschaftsdienst zur Auszahlung',
      hours: paidStandby.hours,
      rate: profile.individualRate,
      amount: round(paidStandby.hours * profile.individualRate),
      basis:
        basis +
        ' Bereits faktorisierte Stunden ausschließlich aus als bezahlt gekennzeichneten BD-Tageswerten; FZA-Stunden sind ausgeschlossen.'
    });
  pay('Samstagszuschlag', 'saturday', 20);
  pay('Sonntagszuschlag', 'sunday', rules.tariff ? 25 : rules.sundayPercent);
  pay('Feiertag mit Freizeitausgleich', 'holiday35', rules.tariff ? 35 : rules.holidayPercent);
  const uncertainHolidayBase = Boolean(wage('holiday100'));
  if (uncertainHolidayBase) {
    check(
      'Lohnart FT100%: Vergütungsgrundlage',
      null,
      wage('holiday100'),
      'Die Lohnart bezeichnet nicht eindeutig die tarifliche Vergütungsgrundlage. Individuelles Stundenentgelt, Zulagenbasis und Abgrenzung zu FT135% anhand der Abrechnung bestätigen.'
    );
    warnings.push('FT100% wird bis zur Klärung der Vergütungsgrundlage nicht geschätzt.');
  }
  pay('Feiertag ohne Freizeitausgleich (135 %)', 'holiday135', 135);
  pay('Überstundenzuschlag', 'overtimeBonus', rules.tariff ? 15 : rules.overtimePercent);
  const overtimeBase = wage('overtimeBase');
  if (knownTable && overtimeBase && profile.overtimeBaseRate)
    payLines.push({
      label: 'Überstunden-Grundvergütung',
      hours: overtimeBase,
      rate: profile.overtimeBaseRate,
      amount: round(overtimeBase * profile.overtimeBaseRate),
      basis: basis + ' Individuelles Stundenentgelt, höchstens Stufe 4.'
    });
  else if (overtimeBase)
    warnings.push('Überstunden-Grundvergütung: individuelles Stundenentgelt (höchstens Stufe 4) fehlt.');
  const allowance = wage('shiftAllowance');
  if (knownTable && allowance)
    payLines.push({
      label: 'Ausgewiesene Schicht-/Wechselschichtzulage',
      hours: 1,
      rate: allowance,
      amount: allowance,
      basis: 'Übernahme des ausgewiesenen Eurobetrags; Anspruchsvoraussetzungen nicht unabhängig geprüft.',
      quantityUnit: 'count'
    });
  const ambiguousHoliday = Boolean(wage('holiday100') && wage('holiday135'));
  if (ambiguousHoliday)
    warnings.push(
      'Feiertags-Lohnarten 100 % und 135 % können dieselben Stunden enthalten. Ein Gesamtbetrag wird deshalb erst nach Klärung der Überschneidung möglich.'
    );
  if ((total('bdHours') ?? 0) > 0)
    warnings.push(
      paidStandby.hours > 0
        ? 'BD-Grundvergütung berücksichtigt als bezahlt gekennzeichnete Tageswerte; BD-FZA wird als Zeitgutschrift geführt. Tatsächliche Zahlung anhand der Lohnabrechnung bestätigen.'
        : 'BD-Grundvergütung ist in dieser Schätzung nicht enthalten: Zahlung, Freizeitausgleich und Kontenzuordnung müssen pro Dienst bestätigt werden.'
    );
  warnings.push(
    'Diese Prüfung vergleicht Arbeitgeberangaben miteinander. Tatsächliche Anwesenheit, Pausen, Dienstplananordnung und tarifliche Überstunden brauchen unabhängige Einträge.'
  );
  warnings.push(
    'Die Zahlungsschätzung enthält nur erkannte Lohnarten. Konkurrenz der Sonn-, Feiertags- und Samstagszuschläge wird hier nicht aus den Zeitspannen rekonstruiert.'
  );
  const hasWageBasis = [
    'night',
    'nightStandby',
    'saturday',
    'sunday',
    'holiday35',
    'holiday135',
    'overtimeBonus',
    'overtimeBase',
    'shiftAllowance'
  ].some(key => Object.hasOwn(report.wageTypes, key));
  const payAvailable =
    knownTable &&
    (hasWageBasis || paidStandby.days.length > 0) &&
    !ambiguousHoliday &&
    !uncertainHolidayBase &&
    !changingRateWithinMonth &&
    !(overtimeBase && !profile.overtimeBaseRate) &&
    !(paidStandby.hours > 0 && !profile.individualRate) &&
    !paidStandby.unresolvedDates.length;
  const estimatedPay = payLines.length && payAvailable ? round(payLines.reduce((n, line) => n + line.amount, 0)) : null;
  for (const line of payLines) {
    const calculation =
      line.label === 'Ausgewiesene Schicht-/Wechselschichtzulage'
        ? `Berechnungsmenge ${show(line.hours)} × ausgewiesener Satz ${show(line.rate)} EUR = ${show(line.amount)} EUR Monatszulage.`
        : `${show(line.hours)} h × ${show(line.rate)} EUR/h = ${show(line.amount)} EUR.`;
    check(
      `Auszahlung: ${line.label}`,
      line.amount,
      null,
      `Leistungsmonat ${report.period}: ${calculation} ${line.basis} Auszahlung dieser Position anhand der zugehörigen Lohnabrechnung prüfen.`,
      'EUR'
    );
  }
  return { checks, payLines, estimatedPay, payAvailable, warnings: [...new Set(warnings)], hoursSummary, information };
}

/** Compare only dates with independently entered work; absent diary dates remain unjudged. */
export function comparePersonalEntries(report: TimeReport, entries: Entry[]): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const crossesMidnight = (e: Entry) => minute(e.start) + durationMinutes(e) > 1440;
  for (const day of report.days) {
    const personal = entries.filter(e => e.kind === 'work' && e.date === day.date);
    if (!personal.length) continue;
    const expected = round(personal.reduce((n, e) => n + (durationMinutes(e) - e.breakMinutes) / 60, 0));
    const source = [day.label, ...day.rawLines, ...day.spans.map(s => s.raw)].join(' ');
    const complexDuty =
      (day.standbyHours ?? 0) > 0 ||
      /BD[-_ ]?St|Bereitschaft/i.test(source) ||
      entries.some(e => e.date === day.date && ['standby', 'callout'].includes(e.kind));
    const previousDate = new Date(Date.parse(day.date) - 86400000).toISOString().slice(0, 10);
    const midnight =
      personal.some(crossesMidnight) ||
      entries.some(e => e.kind === 'work' && e.date === previousDate && crossesMidnight(e));
    const clockChange =
      personal.some(hasClockChange) ||
      entries.some(e => e.kind === 'work' && e.date === previousDate && hasClockChange(e));
    const sorted = personal
      .map(e => ({ start: minute(e.start), end: minute(e.start) + durationMinutes(e) }))
      .sort((a, b) => a.start - b.start);
    const overlap = sorted.some((span, i) => sorted.slice(0, i).some(previous => previous.end > span.start));
    const reported = day.actualHours;
    const review = complexDuty || midnight || overlap || clockChange || reported === null;
    checks.push({
      title: `${day.date}: Eigene Arbeitszeit / Arbeitgeber-Ist`,
      expected,
      reported,
      unit: 'h',
      status: review ? 'review' : Math.abs(expected - reported!) <= 0.011 ? 'ok' : 'difference',
      detail: clockChange
        ? 'Zeitumstellung in Europe/Berlin: Lokale Uhrzeiten bestimmen die fehlende oder doppelte Stunde nicht eindeutig. Tatsächliche Zeitstempel und Arbeitgeberzuordnung prüfen.'
        : overlap
          ? 'Eigene Einträge überschneiden sich. Die summierte Nettozeit enthält möglicherweise Doppelzählungen; Einträge vor Vergleich korrigieren.'
          : complexDuty
            ? 'Eigene Regeldienstzeit ohne Pausen. BD/Ruf-Einsatz oder verschachtelte Arbeitgeberdaten am selben Tag: Zuordnung manuell prüfen.'
            : midnight
              ? 'Eigene Nettozeit dem Beginn-Datum zugeordnet. Ein Dienst überschreitet Mitternacht; Tageszuordnung im Arbeitgebernachweis vor Vergleich klären.'
              : reported === null
                ? 'Eigene Nettozeit vorhanden, aber keine Arbeitgeber-Istzeit für diesen Tag ausgewiesen.'
                : 'Eigene Ankunft bis Feierabend minus die selbst erfassten Pausen, verglichen mit der ausgewiesenen Tages-Istzeit. Vollständigkeit der eigenen Einträge prüfen.'
    });
  }
  return checks;
}
