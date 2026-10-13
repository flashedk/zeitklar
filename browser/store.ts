/** IndexedDB storage adapter: the whole workspace is one Snapshot record, changed in one transaction. */
import type { Mutate } from '../src/lib/actions';
import {
  buildPage,
  exportSnapshot,
  normalizeSnapshot,
  parseBackup,
  restoreBackup,
  type Snapshot,
  type WorkspaceData
} from '../src/lib/workspace';

export {
  addEntries,
  addPendingEntryImport,
  addPendingReport,
  addReport,
  confirmPendingEntryImport,
  confirmPendingReport,
  discardPendingEntryImport,
  discardPendingReport,
  setReviewAcknowledgement,
  validateSettlement,
  type Snapshot
} from '../src/lib/workspace';

let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('zeitklar-local', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('workspace');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () =>
      reject(new Error('Lokaler Browserspeicher ist nicht verfügbar. Bitte einen normalen Browsermodus verwenden.'));
    open.onblocked = () =>
      reject(new Error('Eine andere Registerkarte blockiert den lokalen Speicher. Bitte schließen und neu laden.'));
  }));
}

export async function readSnapshot(): Promise<Snapshot> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('workspace', 'readonly').objectStore('workspace').get('data');
    request.onsuccess = () => {
      try {
        resolve(normalizeSnapshot(request.result));
      } catch (error) {
        reject(error);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export const mutate: Mutate = async fn => {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('workspace', 'readwrite'),
      store = tx.objectStore('workspace');
    const get = store.get('data');
    let result: ReturnType<typeof fn>;
    let caught: unknown;
    get.onsuccess = () => {
      try {
        const snapshot = normalizeSnapshot(get.result);
        result = fn(snapshot);
        store.put(normalizeSnapshot(snapshot), 'data');
      } catch (e) {
        caught = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () =>
      reject(
        caught ??
          new Error('Daten konnten nicht lokal gespeichert werden. Speicherplatz und Browserberechtigungen prüfen.')
      );
  });
};

export async function getPage(): Promise<WorkspaceData> {
  return buildPage(await readSnapshot(), new URL(location.href));
}

const listeners = new Set<(page: WorkspaceData) => void>();
export function subscribe(listener: (page: WorkspaceData) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export async function refresh() {
  const page = await getPage();
  for (const listener of listeners) listener(page);
}

export async function backup() {
  const blob = new Blob([JSON.stringify(exportSnapshot(await readSnapshot()), null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'zeitklar-lokal-export.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function restore(text: string) {
  const backup = parseBackup(text);
  const result = await mutate(s => restoreBackup(s, backup));
  await refresh();
  return result;
}
