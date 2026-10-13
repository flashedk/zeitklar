import { hours } from './calculate';
import type { ReportAudit } from './report';

/** Display-only wording and units leave payout calculations and acknowledgement keys intact. */
export function presentPayLine(line: ReportAudit['payLines'][number]) {
  const basis = line.basis
    .replace(/; keine Zahlungsbestätigung\./g, '.')
    .replace(
      'Bereits faktorisierte Stunden ausschließlich aus als bezahlt gekennzeichneten BD-Tageswerten; FZA-Stunden sind ausgeschlossen.',
      ''
    )
    .replace('Übernahme des ausgewiesenen Eurobetrags; Anspruchsvoraussetzungen nicht unabhängig geprüft.', '')
    .trim();
  const count = line.quantityUnit === 'count' || line.label === 'Ausgewiesene Schicht-/Wechselschichtzulage';
  return {
    basis,
    quantity: count
      ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(line.hours)
      : `${hours(line.hours)} h`
  };
}
