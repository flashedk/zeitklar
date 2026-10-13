// Invented parser scenarios, built from the documented column positions.
// Never load private reports, backups, databases, or deleted fixtures here.
/** @param {number | null} value */
const number = value => (value === null ? '' : value.toFixed(2).replace('.', ','));
/** @param {Array<Array<string | number>>} fields */
const columns = fields => {
  const chars = Array(131).fill(' ');
  for (const [offset, value] of fields)
    for (const [index, char] of String(value).split('').entries()) chars[Number(offset) + index] = char;
  return chars.join('').trimEnd();
};
export const dplHeader = columns([
  [0, 'Tg Text'],
  [47, 'Soll'],
  [54, 'Ist'],
  [71, 'BD'],
  [102, 'Nacht'],
  [109, 'Sa']
]);
/**
 * @param {number} day
 * @param {string} label
 * @param {string} [clocks]
 * @param {Record<number, number>} [amounts]
 */
const row = (day, label, clocks = '', amounts = {}) =>
  columns([
    [0, `${String(day).padStart(2, '0')} ${label}`],
    [31, clocks],
    ...Object.entries(amounts).map(([offset, value]) => [Number(offset), number(value)])
  ]);
/** @param {string} clocks @param {Record<number, number>} amounts */
const continuation = (clocks, amounts) =>
  columns([[31, clocks], ...Object.entries(amounts).map(([offset, value]) => [Number(offset), number(value)])]);
/** @param {string} label @param {number | null} value */
const total = (label, value) => {
  const amount = value !== null && value < 0 ? `${number(-value)}-` : number(value);
  return `${label}|${amount.padStart(12)} |`;
};
/** @param {Array<[string, number | null]>} fields */
const totalRows = fields => fields.map(([label, value]) => total(label, value));
/** @param {number} regular @param {number} standby */
const wages = (regular, standby, saturday = 0, allowance = 0) => [
  'Summenübersicht Lohnarten',
  'FT 35%',
  columns([
    [0, '0,00'],
    [8, '0,00'],
    [16, '0,00'],
    [24, number(saturday)],
    [32, '0,00'],
    [40, '0,00'],
    [64, number(allowance)]
  ]),
  'Nacht Nacht',
  columns([
    [0, number(regular)],
    [8, number(standby)],
    [16, number(regular + standby)]
  ])
];

// Only 16 worked days; all other rows are empty. The totals are round test inputs.
export const julyText = [
  'SYNTHETIC TEST DATA - NO EMPLOYEE OR EMPLOYER',
  'Zeitnachweisliste',
  'Abr.periode : 01.07.2026 - 31.07.2026',
  'gedruckt_am : 01.09.2026',
  'Einzelergebnisse',
  dplHeader,
  ...Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    if ([3, 17].includes(day))
      return [
        row(day, 'BD-St.II-FZA.TVÄ', '06:00 10:00', { 47: 4, 54: 4 }),
        continuation('23:00 04:00', { 71: 5, 78: 1, 102: 4 }),
        continuation('', { 71: 4.75 })
      ].join('\n');
    if (day === 25)
      return [
        row(day, 'BD-St.II-bez.TVÄ', '18:00 24:00', { 71: 6, 78: 1, 102: 3, 109: 2 }),
        continuation('', { 71: 5.7 })
      ].join('\n');
    return row(day, 'Test', day <= 15 ? '08:00 16:00' : '', day <= 15 ? { 47: 8, 54: 8 } : {});
  }),
  'Summenübersicht',
  ...totalRows([
    ['Guthaben Alt', 20],
    ['Istzeit', 120],
    ['vertragl.monatl.Sollzeit', 128],
    ['geplante Sollzeit', 124],
    ['Jahresarb.zeitkonto/Monat', -8],
    ['Guthaben Neu', 21.5],
    ['BD_Anzahl_in_Stufe_I (TVÄ)', null],
    ['BD_Anzahl_in_Stufe_II(TVÄ)', 3],
    ['BD_Std._in_Stufe_I   (TVÄ)', null],
    ['BD_Std._in_Stufe_II  (TVÄ)', 16],
    ['fakt.BD Monat Aufbau (TVÄ)', 5.7],
    ['fakt.BD Monat ges.   (TVÄ)', 5.7],
    ['fakt.BD Monat Abbau  (TVÄ)', null],
    ['Arbeitsschutzkonto/Monat', 128],
    ['Freizeitkonto Feiertagsarb', 0],
    ['Opt-Out', 0],
    ['TV-Ä/TV-N:Freizeitausgl.FT', null],
    ['Abzgl.bez.FT-Std. Monat-4', null]
  ]),
  ...wages(3, 8, 2, 20),
  'Zeitumbuchungen',
  '31.07.2026 31.07.2026 Testumbuchung BD 5,70',
  'Zeitauswertungsfehler',
  columns([
    [0, 'Datum'],
    [40, 'Fehler']
  ]),
  columns([
    [0, '03.07.2026'],
    [40, 'Testhinweis']
  ])
].join('\n');

export const mayText = [
  'SYNTHETIC MIDNIGHT EXCERPT',
  'Zeitnachweisliste',
  'Abr.periode : 01.05.2026 - 31.05.2026',
  'gedruckt_am : 01.06.2026',
  'Einzelergebnisse',
  dplHeader,
  row(12, 'Test', '18:00 24:00', { 47: 6, 54: 6, 102: 3 }),
  'Summenübersicht',
  total('Istzeit', 16),
  total('vertragl.monatl.Sollzeit', 8),
  total('geplante Sollzeit', 12),
  ...wages(3, 0)
].join('\n');

export const decemberText = [
  'SYNTHETIC ABSENCE SCENARIO',
  'Zeitnachweisliste',
  'Abr.periode : 01.12.2025 - 31.12.2025',
  'gedruckt_am : 01.01.2026',
  'Einzelergebnisse',
  dplHeader,
  ...Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    const label = [8, 9].includes(day) ? 'Krankheit' : [15, 16, 17, 22, 23].includes(day) ? 'Urlaub' : 'Test';
    return label === 'Test'
      ? row(day, label)
      : [row(day, 'Test', '', { 47: 8, 54: 8 }), columns([[3, label]])].join('\n');
  }),
  'Summenübersicht',
  total('Istzeit', 56),
  total('vertragl.monatl.Sollzeit', 56),
  total('geplante Sollzeit', 56),
  'Urlaubstage 5,00',
  ...wages(2, 0)
].join('\n');

// A genuine, uncompressed PDF with monospaced text. Generated in memory so there
// is no report file or metadata from a real person to accidentally publish.
/** @param {string} text */
export function syntheticPdf(text) {
  const lines = text.split('\n');
  const pages = Array.from({ length: Math.ceil(lines.length / 45) }, (_, index) =>
    lines.slice(index * 45, (index + 1) * 45)
  );
  const objects = [
    '',
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'
  ];
  const kids = [];
  for (const page of pages) {
    const id = objects.length;
    kids.push(`${id} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 700] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`
    );
    const commands = page
      .map((line, index) => `1 0 0 1 10 ${680 - index * 14} Tm (${line.replace(/[\\()]/g, '\\$&')}) Tj`)
      .join('\n');
    const stream = `BT /F1 10 Tf\n${commands}\nET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 1; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
