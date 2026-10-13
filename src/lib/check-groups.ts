import type { ReviewCheck } from './review';

export type CheckRow = { check: ReviewCheck; children?: ReviewCheck[] };

/** Group daily BD evaluations by compensation while retaining each original review key. */
export function groupStandbyChecks(checks: ReviewCheck[]): CheckRow[] {
  const children = checks.filter(check => /^\d{4}-\d{2}-\d{2}: BD-Grundbewertung$/.test(check.title));
  if (!children.length) return checks.map(check => ({ check }));
  function summary(items: ReviewCheck[], title: string): CheckRow {
    const sum = (key: 'expected' | 'reported') =>
      items.some(check => check[key] === null)
        ? null
        : Math.round(items.reduce((total, check) => total + check[key]!, 0) * 100) / 100;
    const reviews = items.filter(check => check.status === 'review');
    const status = items.some(check => check.status === 'difference') ? 'difference' : reviews.length ? 'review' : 'ok';
    return {
      check: {
        title,
        expected: sum('expected'),
        reported: sum('reported'),
        unit: 'h',
        status,
        detail: `Summe der faktorisierten BD-Stunden aus ${items.length} ${items.length === 1 ? 'Tag' : 'Tagen'}. Tageswerte mit jeweiliger Bereitschaftsstufe aufklappen.`,
        key: '',
        acknowledgedAt:
          reviews.length && reviews.every(check => check.acknowledgedAt)
            ? reviews
                .map(check => check.acknowledgedAt!)
                .sort()
                .at(-1)!
            : null
      },
      children: items
    };
  }
  const classified = children.some(check => check.bdCategory === 'fza' || check.bdCategory === 'paid');
  const summaries = classified
    ? (['fza', 'paid', 'unknown'] as const).flatMap(category => {
        const items = children.filter(check => (check.bdCategory ?? 'unknown') === category);
        return items.length
          ? [
              summary(
                items,
                category === 'fza'
                  ? 'BD mit Freizeitausgleich'
                  : category === 'paid'
                    ? 'BD zur Auszahlung'
                    : 'BD-Ausgleich ungeklärt'
              )
            ]
          : [];
      })
    : [summary(children, 'BD-Grundbewertung gesamt')];
  const ordinary = checks.filter(check => !children.includes(check));
  let anchor = ordinary.findIndex(check => check.title.startsWith('BD-Anzahl:'));
  if (anchor < 0) anchor = ordinary.findIndex(check => check.title.startsWith('BD-Dauer:'));
  const insertAt =
    anchor < 0
      ? checks.slice(0, checks.indexOf(children[0])).filter(check => !children.includes(check)).length
      : anchor + 1;
  const rows = ordinary.map(check => ({ check }) as CheckRow);
  rows.splice(insertAt, 0, ...summaries);
  return rows;
}
