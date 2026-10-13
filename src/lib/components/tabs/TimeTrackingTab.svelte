<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { kinds, type Entry } from '$lib/model';
  import { dateLabel, monthLabel, value } from '$lib/format';
  import { freshEntry } from '$lib/entry-draft';
  import type { MonthView } from '$lib/month-view';
  import type { WorkspaceData } from '$lib/workspace';
  import EntryForm from '../EntryForm.svelte';

  let {
    data,
    view,
    busy,
    submit,
    editEntry,
    entry = $bindable(),
    deleteId = $bindable()
  }: {
    data: WorkspaceData;
    view: MonthView;
    busy: boolean;
    submit: SubmitFunction;
    editEntry: (entry: Entry) => void;
    entry: Entry;
    deleteId: number | null;
  } = $props();
  const { result, ownPay } = $derived(view);
</script>

<section class="panel">
  <EntryForm
    initialDate={entry.date}
    bind:entry
    {submit}
    {busy}
    duties={data.rules.dutyTemplates}
    rules={data.rules}
    onCancel={() => (entry = freshEntry(entry.date))}
  />
</section>
<section class="panel">
  <div class="panel-heading">
    <h2>Eigene Einträge · {monthLabel(data.month)}</h2>
    <span class="badge neutral">{result.rows.length}</span>
  </div>
  {#if !result.rows.length}<p class="muted">
      Noch keine eigenen Einträge in diesem Monat. Ein DPL-Nachweis allein erzeugt keine unabhängigen Arbeitszeiten.
    </p>{:else}<div class="table-scroll">
      <table>
        <thead
          ><tr
            ><th>Datum</th><th>Art</th><th>Zeit</th><th>Pause</th><th>Arbeitszeit</th><th>Zuschläge</th><th>Aktionen</th
            ></tr
          ></thead
        ><tbody
          >{#each result.rows as e}<tr
              ><td>{dateLabel(e.date)}</td><td
                >{kinds[e.kind]}{#if e.kind === 'standby'}<small
                    >{e.meta?.bdTimeOff ? 'Freizeitausgleich / Zeitkonto' : 'Auszahlung'}</small
                  >{/if}{#if e.note}<small>{e.note}</small>{/if}</td
              ><td>{e.start ? `${e.start}–${e.end}` : '—'}</td><td>{e.breakMinutes} min</td><td
                >{value(e.worked || e.credited)}</td
              ><td>{ownPay(e.bonus)}</td><td
                ><div class="row-actions">
                  <button class="text-link" onclick={() => editEntry(e)}>Bearbeiten</button>{#if deleteId === e.id}<form
                      action="?/delete"
                      method="POST"
                      use:enhance={submit}
                    >
                      <input type="hidden" name="id" value={e.id} /><button class="delete-button" disabled={busy}
                        ><svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.8"
                          aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg
                        >Löschen bestätigen</button
                      >
                    </form>
                    <button class="text-link" onclick={() => (deleteId = null)}>Abbrechen</button>{:else}<button
                      class="delete-button"
                      onclick={() => (deleteId = e.id ?? null)}
                      ><svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg
                      >Löschen</button
                    >{/if}
                </div></td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>{/if}
</section>
