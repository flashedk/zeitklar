import { extractPdfText } from '../pdf-text';

export async function extractPdf(bytes: Uint8Array): Promise<string> {
  // PDF.js initializes native Node helpers; load it only for an actual PDF import,
  // so SvelteKit's build-analysis workers never initialize those native bindings.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return extractPdfText(getDocument, bytes);
}
