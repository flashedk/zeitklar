import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { batchUpload, pasteUpload } from '../src/lib/upload';
import { extractPdf } from '../src/lib/server/pdf';
import { reportSignature } from '../src/lib/report-signature';
import type { TimeReport } from '../src/lib/report';

const julyText = await readFile('tests/fixtures/dpl-july-2026.txt', 'utf8');
const mayText = await readFile('tests/fixtures/dpl-may-midnight-2026.txt', 'utf8');

test('batch upload stores both months immediately and keeps successes when another file fails', async () => {
  const saved: TimeReport[] = [];
  const result = await batchUpload(
    [
      new File([julyText], 'july.txt'),
      new File(['%PDF-invalid'], 'bad.pdf'),
      new File([mayText], 'may.txt'),
      new File(['bad'], 'unsupported.csv')
    ],
    async () => {
      assert.equal(saved.length, 1, 'first upload was persisted before reading the second PDF');
      throw new Error('PDF beschädigt');
    },
    report => {
      saved.push(report);
      return true;
    }
  );
  assert.deepEqual(result.uploadMonths, ['2026-07', '2026-05']);
  assert.equal(saved.length, 2);
  assert.deepEqual(
    result.uploadErrors.map(value => value.name),
    ['bad.pdf', 'unsupported.csv']
  );
  assert.equal(result.uploadErrors[0].error, 'PDF beschädigt');
});

test('actual PDF/TXT duplicates share semantic signature during batch upload', async () => {
  const signatures = new Set<string>(),
    pdf = await readFile('tests/fixtures/dpl-july-2026.pdf');
  const result = await batchUpload(
    [new File([julyText], 'july.txt'), new File([pdf], 'july.pdf')],
    extractPdf,
    report => {
      const signature = reportSignature(report);
      if (signatures.has(signature)) return false;
      signatures.add(signature);
      return true;
    }
  );
  assert.equal(signatures.size, 1);
  assert.deepEqual(result.uploadMonths, ['2026-07']);
  assert.equal(result.uploadErrors.length, 0);
  assert.match(result.success, /1 identische Duplikate/);
});

test('upload limits apply before reading oversized batches and per-file failures preserve valid files', async () => {
  let reads = 0;
  const extractor = async () => {
      reads++;
      return '';
    },
    save = () => true;
  await assert.rejects(
    batchUpload(
      Array.from({ length: 21 }, () => new File(['a'], 'a.txt')),
      extractor,
      save
    ),
    /20 Dateien/
  );
  const huge = Array.from({ length: 11 }, () => {
    const file = new File([], 'large.txt');
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 });
    return file;
  });
  await assert.rejects(batchUpload(huge, extractor, save), /100 MB/);
  const large = new File([], 'too-large.txt');
  Object.defineProperty(large, 'size', { value: 10 * 1024 * 1024 + 1 });
  const result = await batchUpload([large, new File([julyText], 'july.txt')], extractor, save);
  assert.equal(reads, 0);
  assert.equal(result.uploadErrors[0].name, 'too-large.txt');
  assert.deepEqual(result.uploadMonths, ['2026-07']);
});

test('generic TXT and pasted reports retain compatible previews and durable callbacks', async () => {
  let report: TimeReport | undefined,
    ownText = '';
  const pasted = await pasteUpload(julyText, value => {
    report = value;
    return true;
  });
  assert.equal(report?.period, '2026-07');
  assert.equal(pasted.preview?.report?.period, '2026-07');
  const own = await batchUpload(
    [new File(['03.11.2026;07:00;16:00;30'], 'own.txt')],
    extractPdf,
    () => true,
    preview => {
      ownText = preview.text;
      return true;
    }
  );
  assert.equal(own.preview?.entries[0].date, '2026-11-03');
  assert.equal(own.preview?.report, undefined);
  assert.deepEqual(own.uploadMonths, ['2026-11']);
  assert.equal(ownText, '03.11.2026;07:00;16:00;30');
});

test('failed persistence is reported per file without discarding prior commits', async () => {
  const saved: string[] = [];
  const result = await batchUpload(
    [new File([julyText], 'july.txt'), new File([mayText], 'may.txt')],
    extractPdf,
    report => {
      if (report.period === '2026-05') throw new Error('Speicher voll');
      saved.push(report.period);
      return true;
    }
  );
  assert.deepEqual(saved, ['2026-07']);
  assert.deepEqual(result.uploadMonths, ['2026-07']);
  assert.deepEqual(result.uploadErrors, [{ name: 'may.txt', error: 'Speicher voll' }]);
});
