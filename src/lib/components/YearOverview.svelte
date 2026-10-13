<script lang="ts">
  import { euro, hours } from '../calculate';
  import { yearOverview } from '../year-overview';
  import type { YearOverviewInput } from '../year-overview';
  import MonthlyBarChart from './MonthlyBarChart.svelte';
  let { data, onmonth }: { data: YearOverviewInput; onmonth: (month: string) => void } = $props();
  const annual = $derived(yearOverview(data, Number(data.month.slice(0, 4))));
  const points = (key: 'balance' | 'pay' | 'standby' | 'overtime') =>
    annual.months.map(m => ({ month: m.month, label: m.label, value: m[key] }));
  const number = (n: number | null, money = false) => (n === null ? '—' : money ? euro(n) : hours(n));
  const componentTotal = $derived(annual.components.reduce((sum, c) => sum + c.amount, 0));
  function pieSlice(start: number, end: number) {
    const point = (turn: number) => [
      110 + 90 * Math.cos(turn * Math.PI * 2 - Math.PI / 2),
      110 + 90 * Math.sin(turn * Math.PI * 2 - Math.PI / 2)
    ];
    const a = point(start),
      b = point(end);
    return `M110 110 L${a[0]} ${a[1]} A90 90 0 ${end - start > 0.5 ? 1 : 0} 1 ${b[0]} ${b[1]} Z`;
  }
  const slices = $derived.by(() => {
    let start = 0;
    return annual.components.map(c => {
      const end = start + c.amount / componentTotal;
      const slice = { ...c, start, end };
      start = end;
      return slice;
    });
  });
</script>

<div class="source-strip">
  <span class="badge">JAHRESÜBERSICHT</span><span><strong>{annual.monthCount} von 12 Monaten</strong> mit Daten</span
  ><span><strong>{annual.payMonthCount} Monate</strong> mit berechenbarer Vergütung</span>
</div>
{#if !annual.monthCount}
  <section class="panel annual-empty">
    <h2>Noch keine Daten für {annual.year}</h2>
    <p>
      Bestätigte Zeitnachweise und eigene Einträge bilden die Jahresauswertung. Wähle ein anderes Jahr oder importiere
      deine Nachweise im Tab Upload.
    </p>
  </section>
{/if}
<div class="stats">
  <article class="stat highlight">
    <span>Zusatzvergütung im Jahr</span><strong class="money">{number(annual.totalPay, true)}</strong>
    <p>Berechnet · brutto · {annual.payMonthCount} Monate</p>
  </article>
  <article class="stat">
    <span>Ø Zusatzvergütung / Monat</span><strong class="money">{number(annual.averagePay, true)}</strong>
    <p>Über die Monate mit berechenbarem Betrag</p>
  </article>
  <article class="stat">
    <span>Ø Bereitschaftsdienste / Monat</span><strong>{number(annual.averageStandby)}</strong>
    <p>Ø Rufbereitschaften: {number(annual.averageOncall)} · aus eigenen Einträgen</p>
  </article>
  <article class="stat">
    <span>Ø Überstunden / Monat</span><strong>{number(annual.averageOvertime)}<small>h</small></strong>
    <p>Ausgewiesene Überstunden-Zuschlagsstunden</p>
  </article>
</div>
<div class="annual-grid">
  <section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">ZEITKONTO</p>
        <h2>Zeitkonto im Jahresverlauf</h2>
      </div>
      <span class="badge neutral">Monatsendstand</span>
    </div>
    <MonthlyBarChart title="Zeitkonto im Jahresverlauf" points={points('balance')} onselect={onmonth} />
    <p class="small-note">
      Endstand laut Nachweis; bei fehlendem Endstand bzw. eigenen Einträgen berechnet. Negative Stände sind rotbraun.
    </p>
  </section>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">ZUSATZVERGÜTUNG</p>
        <h2>Zusatzvergütung pro Monat</h2>
      </div>
      <span class="badge neutral">Brutto</span>
    </div>
    <MonthlyBarChart
      title="Zusatzvergütung pro Monat"
      points={points('pay')}
      unit="EUR"
      color="#789565"
      average={annual.averagePay}
      onselect={onmonth}
    />
    <p class="small-note">
      Zuschläge, Dienstvergütung und Entgeltfortzahlung. Berechnete Beträge; den Auszahlungsabgleich findest du im
      jeweiligen Monat.
    </p>
  </section>
  <section class="panel composition">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">ZUSAMMENSETZUNG</p>
        <h2>Zusatzvergütung im Jahresmittel</h2>
      </div>
    </div>
    {#if componentTotal > 0}
      <div class="pie-layout">
        <svg viewBox="0 0 220 220" role="img" aria-label="Anteile der Zusatzvergütung im Jahresmittel"
          ><title>Zusammensetzung der Zusatzvergütung</title
          >{#each slices as slice}{#if slice.end - slice.start >= 0.999999}<circle
                cx="110"
                cy="110"
                r="90"
                fill={slice.color}><title>{slice.label}: {euro(slice.average)} pro Monat</title></circle
              >{:else}<path d={pieSlice(slice.start, slice.end)} fill={slice.color} stroke="white" stroke-width="2"
                ><title
                  >{slice.label}: {euro(slice.average)} pro Monat · {hours((slice.amount / componentTotal) * 100)} %</title
                ></path
              >{/if}{/each}</svg
        >
        <ul class="pie-legend">
          {#each annual.components as component}<li>
              <span class="swatch" style:background={component.color}></span><span
                >{component.label}<small>{hours((component.amount / componentTotal) * 100)} %</small></span
              ><strong>{euro(component.average)}<small>Ø / Monat</small></strong>
            </li>{/each}
        </ul>
      </div>
    {:else}<div class="chart-empty">Noch keine positiven Vergütungsbeträge für eine Aufteilung vorhanden.</div>{/if}
    <p class="small-note">
      Anteile und Monatsmittel verwenden dieselben {annual.payMonthCount} Monate mit berechenbarer Gesamtvergütung. Zuschläge
      aus Nachweisen und eigenen Einträgen werden nach Zuschlagsart zusammengeführt.
    </p>
  </section>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">DIENSTE</p>
        <h2>Bereitschaftsdienste pro Monat</h2>
      </div>
    </div>
    <MonthlyBarChart
      title="Bereitschaftsdienste pro Monat"
      points={points('standby')}
      unit="Dienste"
      color="#547f91"
      average={annual.averageStandby}
      onselect={onmonth}
    />
    <p class="small-note">
      BD-Anzahl aus dem Nachweis, sonst eigene Dienste. Mehrere Abschnitte desselben konfigurierten Dienstes zählen
      einmal; anteilige Nachweiswerte bleiben erhalten.
    </p>
  </section>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">ÜBERSTUNDEN</p>
        <h2>Überstunden pro Monat</h2>
      </div>
    </div>
    <MonthlyBarChart
      title="Überstunden pro Monat"
      points={points('overtime')}
      color="#d7ac62"
      average={annual.averageOvertime}
      onselect={onmonth}
    />
    <p class="small-note">
      Ausgewiesene Überstunden-Zuschlagsstunden aus den Nachweisen. Ein Zeitkontoplus wird nicht automatisch als
      Überstunden gezählt.
    </p>
  </section>
</div>
<section class="panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">MONATSWERTE</p>
      <h2>Das Jahr im Detail</h2>
    </div>
  </div>
  <p class="small-note">
    Durchschnitte berücksichtigen je Kennzahl nur Monate mit bekannten Werten. „—“ bedeutet fehlende Daten oder
    Berechnungsgrundlagen. Klicke einen Balken oder Monat, um die Monatsübersicht zu öffnen.
  </p>
  <div class="table-scroll">
    <table>
      <thead
        ><tr
          ><th>Monat</th><th>Quelle</th><th>Zeitkonto (h)</th><th>Zusatzvergütung</th><th>BD</th><th
            >Rufbereitschaften</th
          ><th>Überstunden (h)</th></tr
        ></thead
      ><tbody
        >{#each annual.months as month}<tr
            ><td
              ><button class="text-link" onclick={() => onmonth(month.month)}>{month.label} {annual.year} ↗</button></td
            ><td
              >{month.source === 'report'
                ? 'Nachweis'
                : month.source === 'personal'
                  ? 'Eigene Einträge'
                  : 'Keine Daten'}</td
            ><td>{number(month.balance)}</td><td>{number(month.pay, true)}</td><td>{number(month.standby)}</td><td
              >{number(month.oncall)}</td
            ><td>{number(month.overtime)}</td></tr
          >{/each}</tbody
      >
    </table>
  </div>
</section>

<style>
  .annual-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 22px;
    align-items: start;
  }
  .annual-grid .panel {
    margin-bottom: 0;
    min-width: 0;
  }
  .annual-grid {
    margin-bottom: 24px;
  }
  .composition {
    grid-column: 1/-1;
  }
  .pie-layout {
    display: flex;
    align-items: center;
    gap: 32px;
    padding: 8px 0;
  }
  .pie-layout svg {
    width: 230px;
    flex-shrink: 0;
  }
  .pie-legend {
    list-style: none;
    padding: 0;
    margin: 0;
    flex: 1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px 28px;
  }
  .pie-legend li {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }
  .swatch {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    border-radius: 3px;
  }
  .pie-legend li > span:nth-child(2) {
    flex: 1;
  }
  .pie-legend strong {
    white-space: nowrap;
    text-align: right;
    font-size: 13px;
  }
  .pie-legend small {
    display: block;
    color: var(--muted);
    font-size: 11px;
    font-weight: 400;
    margin-top: 4px;
  }
  .chart-empty {
    display: grid;
    place-items: center;
    min-height: 200px;
    background: var(--soft);
    border-radius: 8px;
    color: var(--muted);
    padding: 20px;
  }
  .annual-empty p {
    margin: 12px 0 0;
  }
  .annual-grid .small-note {
    margin-bottom: 0;
  }
  @media (max-width: 1150px) {
    .annual-grid {
      grid-template-columns: 1fr;
    }
    .pie-legend {
      grid-template-columns: 1fr;
    }
    .composition {
      grid-column: auto;
    }
  }
  @media (max-width: 650px) {
    .pie-layout {
      flex-direction: column;
      gap: 16px;
    }
    .pie-legend {
      width: 100%;
    }
    .pie-layout svg {
      width: 190px;
    }
    .annual-grid {
      gap: 16px;
    }
  }
</style>
