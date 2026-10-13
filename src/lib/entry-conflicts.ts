import { absenceConflicts, durationMinutes, isDuty, minute, type Entry } from './model';

// Shared conflict-checking for storing work entries. Used by both the SQLite
// backend (src/lib/server/db.ts) and the IndexedDB backend (browser/store.ts)
// so the rules stay identical across the two persistence layers.
export type EntryConflictResult = { duplicate: boolean; conflict?: string };

function interval(e: Entry): [number, number] {
  const s = Date.parse(e.date) + minute(e.start) * 60000;
  return [s, s + durationMinutes(e) * 60000];
}

/**
 * Checks a single entry against a list of already-stored entries.
 * Returns `{ duplicate: true }` when an identical entry already exists, or
 * `{ conflict: message }` when the entry overlaps an existing shift or clashes
 * with an absence on the same day. Otherwise returns `{ duplicate: false }`.
 */
export function checkEntryConflict(entry: Entry, existing: Entry[]): EntryConflictResult {
  const duplicate = existing.find(
    x => x.date === entry.date && x.start === entry.start && x.end === entry.end && x.kind === entry.kind
  );
  if (duplicate) return { duplicate: true };
  for (const other of existing) {
    if (!isDuty(entry) || !isDuty(other)) {
      if (absenceConflicts(entry, other))
        return {
          duplicate: false,
          conflict: `${entry.date}: Abwesenheit und weiterer Eintrag am selben Tag. Bitte prüfen.`
        };
    } else {
      if (
        (entry.kind === 'oncall' && other.kind === 'callout') ||
        (entry.kind === 'callout' && other.kind === 'oncall')
      )
        continue;
      const [s, end] = interval(entry),
        [os, oe] = interval(other);
      if (s < oe && os < end)
        return { duplicate: false, conflict: `${entry.date}: Überschneidung mit einer gespeicherten Schicht.` };
    }
  }
  return { duplicate: false };
}
