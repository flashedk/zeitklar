<script lang="ts">
  import { euro, hours } from '../calculate';
  let {
    title,
    points,
    unit = 'h',
    color = '#244d3c',
    average = null,
    onselect
  }: {
    title: string;
    points: { month: string; label: string; value: number | null }[];
    unit?: string;
    color?: string;
    average?: number | null;
    onselect: (month: string) => void;
  } = $props();
  const format = (n: number) => (unit === 'EUR' ? euro(n) : `${hours(n)} ${unit}`);
  const values = $derived(points.flatMap(p => (p.value === null ? [] : [p.value])));
  const lower = $derived(Math.min(0, ...values));
  const upper = $derived(Math.max(1, ...values, average ?? 0));
  const span = $derived(upper - lower);
  const y = (n: number) => 208 - ((n - lower) / span) * 180;
  const ticks = $derived(Array.from({ length: 5 }, (_, i) => lower + (span * i) / 4));
  function select(event: MouseEvent, month: string) {
    event.preventDefault();
    onselect(month);
  }
</script>

<div class="chart-scroll">
  <svg
    viewBox="0 0 720 258"
    role="img"
    aria-label={`${title}. ${points.map(p => `${p.label}: ${p.value === null ? 'keine Daten' : format(p.value)}`).join('; ')}`}
  >
    <title>{title}</title>
    {#each ticks as tick}
      <line x1="82" x2="706" y1={y(tick)} y2={y(tick)} stroke="#e0e5dd" />
      <text x="73" y={y(tick) + 4} text-anchor="end" class="tick"
        >{new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1, notation: 'compact' }).format(tick)}</text
      >
    {/each}
    <text x="82" y="15" class="tick">{unit === 'EUR' ? '€ brutto' : unit}</text>
    <line x1="82" x2="706" y1={y(0)} y2={y(0)} stroke="#7d8d82" />
    {#if average !== null}
      <line x1="82" x2="706" y1={y(average)} y2={y(average)} stroke="#aa843f" stroke-dasharray="5 4"
        ><title>Durchschnitt: {format(average)}</title></line
      >
    {/if}
    {#each points as point, index}
      {@const x = 94 + index * 51.5}
      <a
        href={`?month=${point.month}&tab=Monat`}
        onclick={event => select(event, point.month)}
        aria-label={`${point.month}: ${point.value === null ? 'keine Daten' : format(point.value)}. Monat öffnen`}
      >
        <title>{point.month}: {point.value === null ? 'Keine Daten' : format(point.value)} · Monat öffnen</title>
        <rect x={x - 5} y="23" width="44" height="216" fill="transparent" />
        {#if point.value !== null}
          <rect
            {x}
            y={point.value >= 0 ? y(point.value) : y(0)}
            width="34"
            height={Math.max(2, Math.abs(y(point.value) - y(0)))}
            rx="3"
            fill={point.value < 0 ? '#b78979' : color}
          />
        {:else}<text x={x + 17} y={y(0) - 9} text-anchor="middle" class="missing">—</text>{/if}
        <text x={x + 17} y="235" text-anchor="middle" class="month">{point.label}</text>
      </a>
    {/each}
  </svg>
</div>
{#if average !== null}<p class="chart-caption">
    <span aria-hidden="true">┄</span> Monatsdurchschnitt: <strong>{format(average)}</strong>
  </p>{/if}

<style>
  .chart-scroll {
    overflow-x: auto;
  }
  svg {
    display: block;
    width: 100%;
    min-width: 480px;
    font-family: inherit;
  }
  .tick {
    font-size: 11px;
    fill: #6f7c74;
  }
  .month {
    font-size: 12px;
    fill: #3e5648;
  }
  .missing {
    font-size: 15px;
    fill: #a2aba1;
  }
  a:hover rect:not([fill='transparent']),
  a:focus-visible rect:not([fill='transparent']) {
    opacity: 0.72;
  }
  a:focus-visible {
    outline: 2px solid #83aa67;
  }
  .chart-caption {
    font-size: 12px;
    color: #6f7c74;
    margin: 0;
  }
  .chart-caption > span {
    color: #aa843f;
    margin-right: 6px;
  }
</style>
