import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractPdfText } from '../src/lib/pdf-text';
GlobalWorkerOptions.workerSrc = workerUrl;
/** Same extraction as the server path; the bytes never leave the browser. */
export const extractPdf = (bytes: Uint8Array) => extractPdfText(getDocument, bytes);
