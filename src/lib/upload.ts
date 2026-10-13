import { parseText, type Parsed } from './importer';
import { validateReport } from './validate-report';
import type { TimeReport } from './report';
import { validateEntry } from './model';

export const uploadLimits = {
  files: 20,
  fileBytes: 10 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
  textCharacters: 500000
};
export type UploadResult = {
  uploadMonths: string[];
  uploadErrors: { name: string; error: string }[];
  success: string;
  preview?: Parsed;
};
export type EntryPreview = Omit<Parsed, 'report'>;
export type PendingEntryImport = { id: number; preview: EntryPreview; createdAt: string };
type SavePending = (report: TimeReport) => boolean | Promise<boolean>;
type SaveEntriesPending = (preview: EntryPreview) => boolean | Promise<boolean>;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Die Datei konnte nicht gelesen werden.';

export async function parseUpload(file: File, extractPdf: (bytes: Uint8Array) => Promise<string>): Promise<Parsed> {
  if (!file.size) throw new Error('Die Datei ist leer.');
  if (file.size > uploadLimits.fileBytes) throw new Error('Maximale Dateigröße: 10 MB.');
  const extension = file.name.toLowerCase();
  if (!extension.endsWith('.pdf') && !extension.endsWith('.txt')) throw new Error('Unterstützt werden .pdf und .txt.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  if (extension.endsWith('.pdf')) {
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
      throw new Error('Die Datei ist keine gültige PDF-Datei.');
    text = await extractPdf(bytes);
    if (text.trim().length < 10)
      throw new Error('Kein auswertbarer Text gefunden. Gescannte PDFs benötigen zuerst OCR.');
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('windows-1252').decode(bytes);
    }
  }
  if (text.length > uploadLimits.textCharacters)
    throw new Error('Die Datei enthält zu viel Text. Bitte nur einen Monatsauszug verwenden.');
  const parsed = parseText(text, file.name.slice(0, 200));
  if (parsed.report) parsed.report = validateReport(parsed.report);
  else if (!parsed.entries.length)
    throw new Error('Keine auswertbaren Zeitdaten erkannt. Bitte Format und Quelltext prüfen.');
  return parsed;
}

/** Each successful file is committed before reading the next; later errors cannot erase earlier uploads. */
export async function batchUpload(
  files: File[],
  extractPdf: (bytes: Uint8Array) => Promise<string>,
  savePending: SavePending,
  saveEntriesPending?: SaveEntriesPending
): Promise<UploadResult> {
  if (!files.length) throw new Error('Bitte PDF- oder TXT-Dateien auswählen.');
  if (files.length > uploadLimits.files) throw new Error('Bitte höchstens 20 Dateien auf einmal auswählen.');
  if (files.reduce((sum, file) => sum + file.size, 0) > uploadLimits.totalBytes)
    throw new Error('Die ausgewählten Dateien überschreiten zusammen 100 MB.');
  const result: UploadResult = { uploadMonths: [], uploadErrors: [], success: '' };
  let added = 0,
    duplicates = 0,
    generic = 0;
  for (const file of files) {
    try {
      const parsed = await parseUpload(file, extractPdf);
      if (parsed.report) {
        if (await savePending(parsed.report)) added++;
        else duplicates++;
        if (!result.uploadMonths.includes(parsed.report.period)) result.uploadMonths.push(parsed.report.period);
      } else {
        if (saveEntriesPending) {
          if (await saveEntriesPending(validateEntryPreview(parsed))) added++;
          else duplicates++;
        }
        for (const entry of parsed.entries)
          if (!result.uploadMonths.includes(entry.date.slice(0, 7))) result.uploadMonths.push(entry.date.slice(0, 7));
        generic++;
        if (!result.preview || result.preview.report) result.preview = parsed;
        else {
          result.preview.entries.push(...parsed.entries);
          result.preview.warnings.push(...parsed.warnings);
        }
      }
      // Keep the established single-file API usable while the UI moves to the persistent queue.
      if (files.length === 1) result.preview = parsed;
    } catch (error) {
      result.uploadErrors.push({ name: file.name.slice(0, 200), error: errorText(error) });
    }
  }
  result.success = `${added} Importe zur Prüfung gespeichert${duplicates ? `, ${duplicates} identische Duplikate übersprungen` : ''}${generic ? `, ${generic} Dateien mit eigenen Zeiten eingelesen` : ''}.`;
  return result;
}

export async function pasteUpload(
  text: string,
  savePending: SavePending,
  saveEntriesPending?: SaveEntriesPending
): Promise<UploadResult> {
  if (!text.trim() || text.length > uploadLimits.textCharacters)
    throw new Error('Bitte Text einfügen (maximal 500.000 Zeichen).');
  const parsed = parseText(text, 'Eingefügter Zeitnachweis.txt');
  if (!parsed.report) {
    const inserted = saveEntriesPending ? await saveEntriesPending(validateEntryPreview(parsed)) : true;
    return {
      preview: parsed,
      uploadMonths: [...new Set(parsed.entries.map(entry => entry.date.slice(0, 7)))],
      uploadErrors: [],
      success: inserted
        ? 'Eigene Zeiten zur Importprüfung gespeichert.'
        : 'Diese eigenen Zeiten sind bereits gespeichert.'
    };
  }
  const report = validateReport(parsed.report);
  const inserted = await savePending(report);
  return {
    preview: parsed,
    uploadMonths: [report.period],
    uploadErrors: [],
    success: inserted
      ? `Zeitnachweis für ${report.period} zur Prüfung gespeichert.`
      : 'Dieser Zeitnachweis ist bereits gespeichert.'
  };
}

export function validateEntryPreview(raw: unknown): EntryPreview {
  const value = raw as EntryPreview;
  if (
    !value ||
    !Array.isArray(value.entries) ||
    !value.entries.length ||
    value.entries.length > 2000 ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > 20000 ||
    !value.warnings.every(warning => typeof warning === 'string' && warning.length <= 2000) ||
    typeof value.text !== 'string' ||
    value.text.length > uploadLimits.textCharacters ||
    typeof value.filename !== 'string' ||
    value.filename.length > 200
  )
    throw new Error('Die Importvorschau enthält ungültige Daten. Bitte Datei erneut einlesen.');
  return {
    entries: value.entries.map(validateEntry),
    warnings: value.warnings,
    text: value.text,
    filename: value.filename
  };
}
export function entryPreviewSignature(preview: EntryPreview): string {
  const entries = preview.entries.map(validateEntry).map(entry =>
    JSON.stringify({
      ...entry,
      meta: Object.fromEntries(Object.entries(entry.meta ?? {}).sort(([a], [b]) => a.localeCompare(b)))
    })
  );
  return JSON.stringify(entries.sort());
}
