/**
 * Every form action, implemented once. The server wraps these in SvelteKit actions; the browser
 * build calls them directly. `mutate` runs a function on the stored Snapshot in one transaction.
 */
import { applyContinuedPayAction } from './continued-pay';
import { dutyEntriesFromForm } from './duty-entry';
import {
  mergeRulesAt,
  patchMonthSettings,
  setRulesAt,
  splitRulesAt,
  validateEntry,
  validateRules,
  validMonth
} from './model';
import { batchUpload, pasteUpload } from './upload';
import {
  addEntries,
  addPendingEntryImport,
  addPendingReport,
  addReport,
  confirmPendingEntryImport,
  confirmPendingReport,
  deleteEntry,
  discardPendingEntryImport,
  discardPendingReport,
  getSettlement,
  latestReports,
  parseBackup,
  restoreBackup,
  restoreMessage,
  saveSettlement,
  setReviewAcknowledgement,
  validateSettlement,
  type Snapshot
} from './workspace';

export type Mutate = <T>(fn: (snapshot: Snapshot) => T) => Promise<T>;
export type ActionStore = { mutate: Mutate; extractPdf: (bytes: Uint8Array) => Promise<string> };
export type ActionName = keyof typeof actions;

const backupLimit = 50 * 1024 * 1024;
const id = (form: FormData, key: string) => Number(form.get(key));

const actions = {
  'continued-pay': async (form, { mutate }) => {
    await mutate(s => {
      s.continuedPay = applyContinuedPayAction(s.continuedPay, form, latestReports(s), s.rules);
    });
    return { success: 'Entgeltfortzahlung gespeichert.' };
  },
  acknowledge: async (form, { mutate }) => {
    const acknowledged = String(form.get('acknowledged'));
    if (!['true', 'false'].includes(acknowledged)) throw new Error('Ungültige Quittierung.');
    await mutate(s =>
      setReviewAcknowledgement(s, String(form.get('reportKey')), String(form.get('checkKey')), acknowledged === 'true')
    );
    return { success: acknowledged === 'true' ? 'Prüfhinweis quittiert.' : 'Quittierung aufgehoben.' };
  },
  'paste-preview': async (form, { mutate }) =>
    pasteUpload(
      String(form.get('text') || ''),
      report => mutate(s => addPendingReport(s, report)),
      preview => mutate(s => addPendingEntryImport(s, preview))
    ),
  preview: async (form, { mutate, extractPdf }) =>
    batchUpload(
      form.getAll('file').filter((value): value is File => value instanceof File && !!value.name),
      extractPdf,
      report => mutate(s => addPendingReport(s, report)),
      preview => mutate(s => addPendingEntryImport(s, preview))
    ),
  confirm: async (form, { mutate }) => {
    const { report, inserted } = await mutate(s => confirmPendingReport(s, id(form, 'reportId')));
    return {
      imported: true,
      importedMonth: report.period,
      success: inserted
        ? `Zeitnachweis für ${report.period} übernommen.`
        : 'Dieser Zeitnachweis ist bereits übernommen.'
    };
  },
  discard: async (form, { mutate }) => {
    await mutate(s => discardPendingReport(s, id(form, 'reportId')));
    return { success: 'Ungeprüfter Zeitnachweis verworfen.' };
  },
  'confirm-entries': async (form, { mutate }) => {
    const edited = form.get('entries');
    const result = await mutate(s =>
      confirmPendingEntryImport(s, id(form, 'importId'), edited === null ? undefined : JSON.parse(String(edited)))
    );
    return {
      imported: true,
      importedMonth: result.month,
      success: `${result.inserted} eigene Zeiten übernommen, ${result.duplicates} identische Duplikate übersprungen.`
    };
  },
  'discard-entries': async (form, { mutate }) => {
    await mutate(s => discardPendingEntryImport(s, id(form, 'importId')));
    return { success: 'Ungeprüfter Import eigener Zeiten verworfen.' };
  },
  import: async (form, { mutate }) => {
    const rawReport = String(form.get('report') || '');
    if (rawReport && !['null', 'undefined'].includes(rawReport)) {
      const report = JSON.parse(rawReport);
      const inserted = await mutate(s => addReport(s, report));
      return {
        imported: true,
        importedMonth: report.period,
        success: inserted
          ? `Zeitnachweis für ${report.period} gespeichert. Die Arbeitgeberangaben stehen jetzt zur Prüfung bereit.`
          : 'Dieser Zeitnachweis ist bereits gespeichert.'
      };
    }
    const raw = JSON.parse(String(form.get('entries')));
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2000)
      throw new Error('Bitte 1 bis 2000 Einträge importieren.');
    const entries = raw.map(validateEntry),
      source = String(form.get('source') || 'Import').slice(0, 200);
    const result = await mutate(s => addEntries(s, entries, source));
    return {
      imported: true,
      importedMonth: entries[0].date.slice(0, 7),
      success: `${result.inserted} Einträge gespeichert, ${result.duplicates} identische Duplikate übersprungen.`
    };
  },
  'duty-entry': async (form, { mutate }) => {
    const result = await mutate(s => addEntries(s, dutyEntriesFromForm(form, s.rules), 'Dienstvorlage'));
    return {
      saved: true,
      success: result.inserted
        ? 'Dienst mit allen Zeitabschnitten gespeichert.'
        : 'Dieser Dienst ist bereits gespeichert.'
    };
  },
  entry: async (form, { mutate }) => {
    const entry = validateEntry({
      date: form.get('date'),
      start: form.get('start'),
      end: form.get('end'),
      breakMinutes: Number(form.get('breakMinutes')),
      kind: form.get('kind'),
      note: String(form.get('note') || ''),
      meta: JSON.parse(String(form.get('meta') || '{}'))
    });
    const editId = form.get('id') ? id(form, 'id') : undefined;
    if (editId !== undefined && (!Number.isInteger(editId) || editId < 1)) throw new Error('Ungültiger Eintrag.');
    const result = await mutate(s => addEntries(s, [entry], 'Manuell', editId));
    return {
      saved: true,
      success: result.duplicates ? 'Dieser Eintrag ist bereits gespeichert.' : 'Eintrag gespeichert.'
    };
  },
  delete: async (form, { mutate }) => {
    await mutate(s => deleteEntry(s, id(form, 'id')));
    return { success: 'Eintrag gelöscht.' };
  },
  rules: async (form, { mutate }) => {
    const rules = validateRules(JSON.parse(String(form.get('rules'))));
    // With a month, the edit goes into the profile version in effect for that month only.
    const month = form.get('month');
    if (month !== null && !validMonth(String(month))) throw new Error('Ungültiger Monat.');
    await mutate(s => {
      s.rules = month === null ? rules : validateRules(setRulesAt(s.rules, String(month), rules));
    });
    return {
      success:
        month === null
          ? 'Einstellungen gespeichert. Alle Monate werden mit diesem Profil neu berechnet.'
          : 'Einstellungen gespeichert.'
    };
  },
  'rules-version': async (form, { mutate }) => {
    const month = String(form.get('month')),
      operation = String(form.get('operation'));
    if (!validMonth(month)) throw new Error('Ungültiger Monat.');
    if (!['split', 'merge'].includes(operation)) throw new Error('Ungültige Aktion für die Profilfassung.');
    await mutate(s => {
      s.rules = validateRules(operation === 'split' ? splitRulesAt(s.rules, month) : mergeRulesAt(s.rules, month));
    });
    return {
      success:
        operation === 'split'
          ? 'Neue Profilfassung angelegt. Frühere Monate behalten ihre bisherigen Einstellungen.'
          : 'Profilfassungen zusammengeführt.'
    };
  },
  'month-settings': async (form, { mutate }) => {
    await mutate(s => saveSettlement(s, patchMonthSettings(form, getSettlement(s, String(form.get('month'))))));
    return { success: 'Monatseinstellungen gespeichert.' };
  },
  settlement: async (form, { mutate }) => {
    const value = validateSettlement(form);
    await mutate(s => saveSettlement(s, value));
    return { success: 'Monatsabgleich gespeichert.' };
  },
  restore: async (form, { mutate }) => {
    const file = form.get('backup');
    if (!(file instanceof File) || !file.size) throw new Error('Bitte eine Sicherungsdatei auswählen.');
    if (file.size > backupLimit) throw new Error('Sicherung zu groß (maximal 50 MB).');
    const backup = parseBackup(await file.text());
    const result = await mutate(s => restoreBackup(s, backup));
    return { ...result, success: restoreMessage(result) };
  }
} satisfies Record<string, (form: FormData, store: ActionStore) => Promise<Record<string, unknown>>>;

export const actionNames = Object.keys(actions) as ActionName[];

export async function runAction(name: string, form: FormData, store: ActionStore): Promise<Record<string, unknown>> {
  if (!Object.hasOwn(actions, name)) throw new Error('Unbekannte Aktion.');
  return actions[name as ActionName](form, store);
}
