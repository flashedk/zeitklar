<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { untrack } from 'svelte';
  import { dutyDefaultTimes, type DutyTemplate } from '$lib/duty-templates';
  import { dutyEntries } from '$lib/duty-entry';
  import { rulesAt, dailyTargetHours, isDuty, kinds, validDate, type Entry, type Rules } from '$lib/model';
  import { hours } from '$lib/calculate';
  import { effectiveHolidays } from '$lib/holidays';
  let {
    initialDate,
    submit,
    busy = false,
    duties = [],
    showDate = true,
    entry = $bindable(),
    rules,
    onCancel
  }: {
    initialDate: string;
    submit: SubmitFunction;
    busy?: boolean;
    duties?: DutyTemplate[];
    showDate?: boolean;
    entry?: Entry;
    rules: Rules;
    onCancel?: () => void;
  } = $props();
  let localEntry = $state<Entry>(
    untrack(() => ({ date: initialDate, start: '', end: '', breakMinutes: 30, kind: 'work', note: '', meta: {} }))
  );
  let selectedDuty = $state('');
  const draft = $derived(entry ?? localEntry);
  const configured = $derived(selectedDuty !== '' && !draft.id);
  const timed = $derived(configured || isDuty(draft));
  const target = $derived(
    !validDate(draft.date) ||
      effectiveHolidays(rules, Number(draft.date.slice(0, 4))).includes(draft.date) ||
      (rulesAt(rules, draft.date).tariff && ['12-24', '12-31'].includes(draft.date.slice(5)))
      ? 0
      : dailyTargetHours(rules, draft.date)
  );
  const meta = $derived({
    ...draft.meta,
    ...(!configured && timed && draft.start && draft.start === draft.end ? { fullDay: true } : {})
  });
  $effect(() => {
    const date = initialDate;
    untrack(() => {
      if (!entry) localEntry.date = date;
    });
  });
  $effect(() => {
    const current = entry;
    untrack(() => {
      if (current) selectedDuty = '';
    });
  });
  const now = () =>
    new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date());
  function chooseDuty(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    if (value.startsWith('duty:')) {
      selectedDuty = value.slice(5);
      const defaults = dutyDefaultTimes(duties[Number(selectedDuty)]);
      draft.start = defaults?.start ?? '';
      draft.end = defaults?.end ?? '';
      draft.breakMinutes = 0;
      draft.meta = {};
      draft.note = '';
      draft.kind = 'work';
    } else {
      selectedDuty = '';
      draft.kind = value as Entry['kind'];
      draft.meta = {};
      if (!isDuty(draft)) {
        draft.start = '';
        draft.end = '';
        draft.breakMinutes = 0;
      } else if (!draft.start) {
        draft.start = '07:00';
        draft.end = '15:30';
        draft.breakMinutes = draft.kind === 'oncall' ? 0 : 30;
      }
      if (draft.kind === 'oncall') draft.breakMinutes = 0;
    }
  }
  const preview = $derived.by(() => {
    if (!configured || !draft.start || !draft.end) return { entries: [] as Entry[], error: '' };
    try {
      return { entries: dutyEntries(duties[Number(selectedDuty)], draft.date, draft.start, draft.end), error: '' };
    } catch (error) {
      return { entries: [] as Entry[], error: error instanceof Error ? error.message : 'Bitte Zeiten prüfen.' };
    }
  });
</script>

<div class="daily-log">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">MEINE TAGESAUFZEICHNUNG</p>
      <h2>{draft.id ? 'Eintrag bearbeiten' : 'Dienst erfassen'}</h2>
    </div>
    {#if draft.id && onCancel}<button class="secondary" onclick={onCancel}>Abbrechen</button>{:else}<span class="badge"
        >Eigene Zeiten</span
      >{/if}
  </div>
  <form
    id={showDate ? 'entry-form' : undefined}
    action={configured ? '?/duty-entry' : '?/entry'}
    method="POST"
    use:enhance={submit}
  >
    <input type="hidden" name="id" value={draft.id ?? ''} />
    <input type="hidden" name="kind" value={draft.kind} />
    <input type="hidden" name="meta" value={JSON.stringify(meta)} />
    {#if configured}<input type="hidden" name="duty" value={selectedDuty} />{/if}
    {#if !showDate}<input type="hidden" name="date" value={draft.date} />{/if}
    <div class="form-grid">
      {#if showDate}<label>Datum<input type="date" name="date" bind:value={draft.date} required /></label>{/if}
      <label
        >Dienst<select value={configured ? `duty:${selectedDuty}` : draft.kind} onchange={chooseDuty}>
          {#if !draft.id && duties.length}<optgroup label="Meine konfigurierten Dienste"
              >{#each duties as duty, i}<option value={`duty:${i}`}>{duty.name}</option>{/each}</optgroup
            >{/if}
          <optgroup label="Weitere Dienstarten"
            >{#each Object.entries(kinds) as [kind, label]}<option value={kind}>{label}</option>{/each}</optgroup
          >
        </select></label
      >
      {#if timed}
        <label
          >Beginn
          <div class="time-now">
            <input type="time" name="start" bind:value={draft.start} required /><button
              type="button"
              onclick={() => (draft.start = now())}>Jetzt</button
            >
          </div></label
        >
        <label
          >Ende
          <div class="time-now">
            <input type="time" name="end" bind:value={draft.end} required /><button
              type="button"
              onclick={() => (draft.end = now())}>Jetzt</button
            >
          </div></label
        >
        <label
          >Pause (Minuten)<input
            type="number"
            name="breakMinutes"
            min="0"
            max="1439"
            bind:value={draft.breakMinutes}
            required
          /></label
        >
      {:else}<input type="hidden" name="breakMinutes" value="0" />{/if}
      <label
        >Notiz<input
          name="note"
          bind:value={draft.note}
          maxlength="1000"
          placeholder="Optional, z. B. Diensttausch"
        /></label
      >
    </div>
    {#if draft.kind === 'rest' || draft.kind === 'timeoff'}<p class="notice">
        Sollzeit laut Wochenprofil: {hours(target)} h. Keine Arbeitszeitgutschrift; die Sollstunden werden über das Zeitkonto
        ausgeglichen.
      </p>{/if}
    {#if (draft.kind === 'sick' || draft.kind === 'vacation') && draft.meta}<label
        >{draft.kind === 'sick' ? 'Krankheitstag' : 'Urlaubstag'} im Dienstplan<select
          bind:value={draft.meta[draft.kind === 'sick' ? 'sickPayEligible' : 'vacationPayEligible']}
          ><option value={undefined}>Aus Sollprofil / Nachweis ableiten</option><option value={false}
            >Geplantes Frei / FZA – kein Tag zur Vergütung</option
          ><option value={true}>Geplanter Arbeitstag – Tag zur Vergütung</option></select
        ></label
      >{/if}
    {#if preview.entries.length}<div class="duty-preview" aria-live="polite">
        {#each preview.entries as phase}<span
            ><strong>{phase.start}–{phase.end}</strong>
            {phase.kind === 'standby'
              ? `Bereitschaft · Stufe ${phase.meta?.bdLevel} · ${phase.meta?.bdTimeOff ? 'Freizeitausgleich' : 'Auszahlung'}`
              : 'Regelarbeitszeit'}{#if phase.date !== draft.date}<small>Folgetag</small>{/if}</span
          >{/each}
      </div>{/if}
    {#if preview.error}<p class="notice warning" role="alert">{preview.error}</p>{/if}
    {#if timed && draft.meta}<details>
        <summary>Zusatzpunkte & Dienstplanzuschlag</summary>
        <div class="form-grid">
          <label>BD-Zusatzpunkte<input type="number" min="0" max="200" bind:value={draft.meta.bdExtraPoints} /></label
          ><label
            >Dienstplanzuschlag (%)<input type="number" min="0" max="200" bind:value={draft.meta.planPercent} /></label
          >
        </div>
      </details>{/if}
    <div class="quick-log-footer">
      <p class="small-note">
        {configured
          ? 'Zeitabschnitte, Bereitschaftsstufe und BD-Ausgleich werden aus deinen Einstellungen übernommen.'
          : timed
            ? 'Ein Ende vor dem Beginn liegt am Folgetag. Gleiche Uhrzeiten zählen als 24-Stunden-Dienst.'
            : 'Sollstunden werden aus deinem Wochenprofil und den Feiertagen berechnet.'}
      </p>
      <button class="primary" disabled={busy || !!preview.error || (configured && !preview.entries.length)}
        >{draft.id ? 'Änderungen speichern' : 'Dienst speichern'} ✓</button
      >
    </div>
  </form>
</div>

<style>
  .duty-preview {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 20px;
  }
  .duty-preview > span {
    padding: 10px 12px;
    background: #f2f6ea;
    border: 1px solid #dce7cf;
    border-radius: 7px;
    font-size: 12px;
    color: #627755;
  }
  .duty-preview strong {
    font-weight: 600;
  }
  .duty-preview small {
    display: block;
    font-size: 11px;
    margin-top: 4px;
    color: #87917f;
  }
  @media (max-width: 700px) {
    .duty-preview {
      gap: 8px;
    }
  }
</style>
