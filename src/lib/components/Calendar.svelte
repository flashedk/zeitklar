<script lang="ts">
  import type { Entry, Rules } from '$lib/model';
  import { kinds } from '$lib/model';
  import type { TimeReport } from '$lib/report';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { hours } from '$lib/calculate';
  import EntryForm from './EntryForm.svelte';
  import { calendarBlocks, calendarSpans } from '$lib/calendar-spans';
  import { configuredEntry } from '$lib/duty-entry';
  import type { DutyTemplate } from '$lib/duty-templates';
  let {
    month,
    report,
    entries: storedEntries,
    holidays,
    submit,
    busy,
    onAdd,
    onEdit,
    rules,
    duties = []
  }: {
    rules: Rules;
    duties?: DutyTemplate[];
    month: string;
    report: TimeReport | null;
    entries: Entry[];
    holidays: { date: string; name: string }[];
    submit: SubmitFunction;
    busy: boolean;
    onAdd: (date: string) => void;
    onEdit: (e: Entry) => void;
  } = $props();
  const entries = $derived(storedEntries.map(entry => configuredEntry(entry, rules)));
  let selected = $state('');
  const cells = $derived.by(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Array.from({ length: Math.ceil((count + offset) / 7) * 7 }, (_, i) => {
      const d = i - offset + 1;
      return d > 0 && d <= count ? `${month}-${String(d).padStart(2, '0')}` : null;
    });
  });
  const selectedReport = $derived(report?.days.find(d => d.date === selected));
  const selectedSpans = $derived(
    selectedReport ? calendarSpans(selectedReport.date, selectedReport.spans, entries) : []
  );
  const selectedEntries = $derived(entries.filter(e => (e.meta?.dutyDate ?? e.date) === selected));
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  $effect(() => {
    selected = month === today.slice(0, 7) ? today : `${month}-01`;
  });
  const label = (date: string) =>
    new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
      new Date(`${date}T12:00:00Z`)
    );
</script>

<section class="panel calendar-panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">DEIN DIENSTPLAN</p>
      <h2>Der Monat auf einen Blick</h2>
    </div>
    <div class="calendar-legend">
      <span><i class="employer-dot"></i> Betrieb</span><span><i class="personal-dot"></i> Eigene Zeiten</span>
    </div>
  </div>
  <p class="small-note">
    Wähle einen Tag für alle Dienste und deine Tagesaufzeichnung. Passende eigene Zeitabschnitte werden im Kalender
    nicht doppelt angezeigt. Wähle den Tag für die Details.
  </p>
  <div class="calendar-grid">
    {#each ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as weekday}<div class="calendar-weekday">
        {weekday}
      </div>{/each}{#each cells as date, i}{#if date}{@const day = report?.days.find(d => d.date === date)}{@const own =
          entries.filter(e => (e.meta?.dutyDate ?? e.date) === date)}{@const blocks = calendarBlocks(
          date,
          day?.spans ?? [],
          entries
        )}{@const holiday = holidays.find(h => h.date === date)}<button
          class="calendar-day"
          class:chosen={date === selected}
          class:today={date === today}
          class:weekend={i % 7 >= 5}
          class:holiday={!!holiday}
          onclick={() => (selected = date)}
          aria-label={`${label(date)}${holiday ? `, ${holiday.name}` : ''}, ${day?.spans.length ?? 0} Dienste laut Betrieb, ${own.length} eigene Einträge`}
          aria-pressed={date === selected}
          ><div class="calendar-date">
            <b>{Number(date.slice(-2))}</b>{#if holiday}<span title={holiday.name}>FT</span>{/if}
          </div>
          {#if holiday}<small class="calendar-holiday">{holiday.name}</small>{/if}{#each blocks as block}<span
              class:unknown={block.unknown}
              class:standby={block.standby}
              class:employer={block.source === 'employer'}
              class:personal={block.source === 'personal'}
              class="calendar-shift"
              ><strong>{block.displayLabel}</strong>{#if block.start}<small>{block.start}–{block.end}</small>{/if}</span
            >{/each}{#if day && !day.spans.length && day.label && !own.length}<span class="calendar-note"
              >{day.label}</span
            >{/if}</button
        >{:else}<div class="calendar-day blank"></div>{/if}{/each}
  </div>
</section>
{#if selected}<section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">AUSGEWÄHLTER TAG</p>
        <h2>{label(selected)}</h2>
      </div>
      <button class="secondary" onclick={() => onAdd(selected)}>Dienst erfassen +</button>
    </div>
    {#if selectedReport}<div class="selected-source">
        <span class="badge neutral">Laut Betrieb</span><span
          >Soll {selectedReport.plannedHours == null ? '—' : hours(selectedReport.plannedHours)} h</span
        ><span>Ist {selectedReport.actualHours == null ? '—' : hours(selectedReport.actualHours)} h</span>
      </div>
      {#each selectedSpans as span}<div class="issue">
          <strong>{span.start}–{span.end}</strong><span>{span.label} · {span.description}</span>
        </div>{/each}
      <details>
        <summary>Quellzeilen dieses Tages</summary>
        <pre class="raw-text">{selectedReport.rawLines.join('\n')}</pre>
      </details>{/if}{#if selectedEntries.length}<div class="selected-source">
        <span class="badge">Eigene Zeiten</span>
      </div>
      {#each selectedEntries as e}<div class="issue">
          <strong>{e.start ? `${e.start}–${e.end}` : 'Abwesenheit'}</strong><span
            >{e.meta?.dutyName ? `${e.meta.dutyName} · ` : ''}{kinds[e.kind]}{e.kind === 'standby' && e.meta?.bdLevel
              ? ` · Stufe ${e.meta.bdLevel}`
              : ''} · Pause {e.breakMinutes} min</span
          ><button class="text-link" onclick={() => onEdit(e)}>Bearbeiten</button>
        </div>{/each}{/if}{#if !selectedReport && !selectedEntries.length}<p class="muted">
        Für diesen Tag sind noch keine Dienste gespeichert.
      </p>{/if}<EntryForm initialDate={selected} {submit} {busy} {duties} {rules} showDate={false} />
  </section>{/if}
