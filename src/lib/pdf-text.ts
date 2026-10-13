import type { getDocument as GetDocument } from 'pdfjs-dist';

/**
 * Position-preserving text extraction shared by the server and the browser build.
 * Compact extraction would lose empty columns, and with them the meaning of DPL amounts.
 * Each target passes its own pdf.js build (legacy Node build vs. browser build with worker).
 */
export async function extractPdfText(getDocument: typeof GetDocument, bytes: Uint8Array): Promise<string> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false });
  try {
    const document = await task.promise;
    const pages: string[] = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const items = content.items.filter(
        (item): item is Extract<typeof item, { str: string }> => 'str' in item && !!item.str.trim()
      );
      if (!items.length) continue;
      // DPL exports use a monospaced font. Median width also gives readable layout for other PDFs.
      const widths = items
        .filter(item => item.str.length && item.width > 0)
        .map(item => item.width / item.str.length)
        .sort((a, b) => a - b);
      const characterWidth = Math.max(1, widths[Math.floor(widths.length / 2)] || 5);
      const left = Math.min(...items.map(item => item.transform[4]));
      const rows: { y: number; items: typeof items }[] = [];
      for (const item of items) {
        const y = item.transform[5];
        let row = rows.find(candidate => Math.abs(candidate.y - y) < 2);
        if (!row) {
          row = { y, items: [] };
          rows.push(row);
        }
        row.items.push(item);
      }
      pages.push(
        rows
          .sort((a, b) => b.y - a.y)
          .map(row => {
            let line = '';
            for (const item of row.items.sort((a, b) => a.transform[4] - b.transform[4])) {
              const column = Math.max(0, Math.round((item.transform[4] - left) / characterWidth));
              line = line.padEnd(column, ' ');
              if (line.length > column && !line.endsWith(' ')) line += ' ';
              line += item.str;
            }
            return line.trimEnd();
          })
          .join('\n')
      );
      page.cleanup();
    }
    const result = pages.join('\n\n');
    if (!result.trim())
      throw new Error(
        'Die PDF enthält keinen lesbaren Text. Bitte einen PDF-Export oder eine TXT-Datei verwenden; gescannte Seiten benötigen OCR.'
      );
    return result;
  } finally {
    await task.destroy();
  }
}
