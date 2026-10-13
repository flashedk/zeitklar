<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { untrack } from 'svelte';
  import { isEmptyDutyTemplate } from '$lib/duty-templates';
  import { freshEntry } from '$lib/entry-draft';
  import { monthLabel } from '$lib/format';
  import { getHolidays } from '$lib/holidays';
  import { effectiveRules, validateRules, type Entry, type Rules, type Settlement } from '$lib/model';
  import { monthView } from '$lib/month-view';
  import type { EntryPreview } from '$lib/upload';
  import { monthHasPending, type WorkspaceData } from '$lib/workspace';
  import Calendar from '$lib/components/Calendar.svelte';
  import YearOverview from '$lib/components/YearOverview.svelte';
  import MonthTab from '$lib/components/tabs/MonthTab.svelte';
  import UploadTab from '$lib/components/tabs/UploadTab.svelte';
  import TimeTrackingTab from '$lib/components/tabs/TimeTrackingTab.svelte';
  import ReviewTab from '$lib/components/tabs/ReviewTab.svelte';
  import SettingsTab from '$lib/components/tabs/SettingsTab.svelte';

  let { data, localMode = false }: { data: WorkspaceData; localMode?: boolean } = $props();
  let entryImportDrafts = $state<Record<number, EntryPreview>>({});
  const tabs = ['Übersicht', 'Monat', 'Kalender', 'Upload', 'Zeiterfassung', 'Abgleich', 'Einstellungen'];
  let tab = $state<string>(untrack(() => data.initialTab ?? 'Übersicht'));
  let timeTrackingOpened = false;
  let busy = $state(false);
  let error = $state('');
  let success = $state('');
  let uploadErrors = $state<{ name: string; error: string }[]>([]);
  let uploadedMonths = $state<string[]>([]);
  // The editor shows the profile version in effect for `rulesMonth` and saves into that version.
  let rulesMonth = $state(untrack(() => data.month));
  let rules = $state<Rules>(untrack(() => structuredClone(effectiveRules(data.rules, data.month))));
  let settlement = $state<Settlement>(untrack(() => structuredClone(data.settlement)));
  let holidayText = $state(untrack(() => rules.holidays.join('\n')));
  let entry = $state<Entry>(untrack(() => freshEntry()));
  let deleteId = $state<number | null>(null);
  let rulesForm = $state<HTMLFormElement>();
  let rulesSaving = $state(false);
  let rulesStatus = $state<'saved' | 'pending' | 'saving' | 'error' | 'invalid'>('saved');
  let rulesError = $state('');
  let savedRules = $state(untrack(() => JSON.stringify(effectiveRules(data.rules, data.month))));
  let toast = $state<{ message: string; tone: 'saving' | 'success' | 'error' } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let rulesTimer: ReturnType<typeof setTimeout> | undefined;
  let lastDraftMonth = untrack(() => data.month);
  let adjustmentForm = $state<HTMLFormElement>();
  let adjustmentDraft = $state(untrack(() => ({ month: data.month, value: data.settlement.adjustmentHours })));
  let savedAdjustments = $state<Record<string, number>>(
    untrack(() => ({ [data.month]: data.settlement.adjustmentHours }))
  );
  const adjustmentQueue = new Map<string, { value: number; due: number }>();
  const adjustmentDrafts = new Map<string, number | undefined>();
  const failedAdjustments = new Map<string, number>();
  let adjustmentSaving = $state(false);
  let adjustmentStatus = $state<'saved' | 'pending' | 'saving' | 'error' | 'invalid'>('saved');
  let adjustmentTimer: ReturnType<typeof setTimeout> | undefined;

  const rulesJSON = $derived(
    JSON.stringify({
      ...rules,
      dutyTemplates: (rules.dutyTemplates ?? []).filter(duty => !isEmptyDutyTemplate(duty)),
      holidays: holidayText.split(/[\s,;]+/).filter(Boolean)
    })
  );
  const view = $derived(monthView(data));
  const monthRules = $derived(effectiveRules(data.rules, data.month));
  const reviewMonths = $derived(data.reviewMonths);
  const calendarHolidays = $derived([
    ...getHolidays(Number(data.month.slice(0, 4)), monthRules.federalState, {
      assumption: monthRules.localAssumption,
      augsburg: monthRules.localAugsburg,
      corpusChristi: monthRules.localCorpusChristi
    }),
    ...monthRules.holidays.map(date => ({ date, name: 'Zusätzlicher Feiertag' }))
  ]);
  function openReviewMonth(month: string) {
    tab = monthHasPending(data, month) ? 'Upload' : 'Abgleich';
    goto(`?month=${month}`, { keepFocus: true });
  }
  function openTab(item: string) {
    if (item === 'Zeiterfassung' && !timeTrackingOpened) {
      entry = freshEntry();
      timeTrackingOpened = true;
      if (data.month !== entry.date.slice(0, 7)) goto(`?month=${entry.date.slice(0, 7)}`, { keepFocus: true });
    }
    tab = item;
  }
  function showToast(message: string, tone: 'saving' | 'success' | 'error') {
    if (toastTimer) clearTimeout(toastTimer);
    toast = { message, tone };
    if (tone === 'success') toastTimer = setTimeout(() => (toast = null), 4500);
  }
  $effect(() => {
    const incoming = monthRules,
      month = data.month;
    untrack(() => {
      // Unsaved edits keep their version; the editor follows the month once they are saved.
      if (
        !rulesSaving &&
        rulesJSON === savedRules &&
        (JSON.stringify(incoming) !== savedRules || month !== rulesMonth)
      ) {
        rules = structuredClone(incoming);
        holidayText = incoming.holidays.join('\n');
        savedRules = JSON.stringify(incoming);
        rulesMonth = month;
      }
    });
  });
  $effect(() => {
    const month = data.month;
    if (month !== lastDraftMonth) {
      settlement = untrack(() => structuredClone(data.settlement));
      adjustmentDraft = {
        month,
        value: adjustmentDrafts.has(month) ? adjustmentDrafts.get(month)! : data.settlement.adjustmentHours
      };
      if (!adjustmentQueue.has(month)) savedAdjustments[month] = data.settlement.adjustmentHours;
      updateAdjustmentStatus();
      entry = freshEntry();
      entryImportDrafts = {};
      deleteId = null;
      error = '';
      success = '';
      lastDraftMonth = month;
    }
  });
  $effect(() => {
    const list = data.pendingEntryImports,
      month = data.month;
    untrack(() => {
      for (const item of list)
        if (!entryImportDrafts[item.id]) entryImportDrafts[item.id] = structuredClone(item.preview);
      for (const id of Object.keys(entryImportDrafts))
        if (!list.some(item => item.id === Number(id))) delete entryImportDrafts[Number(id)];
    });
  });
  function validateSettings(json: string) {
    const draft = JSON.parse(json) as Rules;
    if (draft.workTimeChangeEnabled && (!draft.weeklyHoursBefore || !draft.weeklyHoursAfter))
      throw new Error('Bitte beide Wochenarbeitszeiten vollständig eingeben.');
    return validateRules(draft);
  }
  function saveRulesNow() {
    if (rulesSaving || !rulesForm || rulesJSON === savedRules) return;
    try {
      validateSettings(rulesJSON);
    } catch (e) {
      rulesStatus = 'invalid';
      rulesError = e instanceof Error ? e.message : 'Bitte die Einstellungen prüfen.';
      if (toast?.tone === 'saving') toast = null;
      return;
    }
    rulesForm.requestSubmit();
  }
  $effect(() => {
    const json = rulesJSON;
    untrack(() => {
      if (rulesTimer) clearTimeout(rulesTimer);
      if (json === savedRules) {
        rulesStatus = rulesSaving ? 'saving' : 'saved';
        rulesError = '';
        return;
      }
      try {
        validateSettings(json);
      } catch (e) {
        rulesStatus = 'invalid';
        rulesError = e instanceof Error ? e.message : 'Bitte die Einstellungen prüfen.';
        if (toast?.tone === 'saving') toast = null;
        return;
      }
      if (!rulesSaving) rulesStatus = 'pending';
      rulesError = '';
      rulesTimer = setTimeout(saveRulesNow, 650);
    });
    return () => {
      if (rulesTimer) clearTimeout(rulesTimer);
    };
  });
  const saveSettings: SubmitFunction = ({ formData, cancel }) => {
    if (rulesSaving) {
      cancel();
      return;
    }
    const snapshot = String(formData.get('rules'));
    try {
      validateSettings(snapshot);
    } catch (e) {
      cancel();
      rulesStatus = 'invalid';
      rulesError = e instanceof Error ? e.message : 'Bitte die Einstellungen prüfen.';
      if (toast?.tone === 'saving') toast = null;
      return;
    }
    rulesSaving = true;
    rulesStatus = 'saving';
    rulesError = '';
    showToast('Einstellungen werden gespeichert …', 'saving');
    return async ({ result: response, update }) => {
      try {
        const payload =
          response.type === 'success' || response.type === 'failure'
            ? (response.data as Record<string, unknown>)
            : null;
        if (response.type !== 'success' || payload?.error)
          throw new Error(String(payload?.error || 'Einstellungen konnten nicht gespeichert werden.'));
        savedRules = snapshot;
        await update({ reset: false });
        rulesStatus = 'saved';
        showToast('Einstellungen gespeichert', 'success');
      } catch (e) {
        rulesStatus = 'error';
        rulesError = e instanceof Error ? e.message : 'Einstellungen konnten nicht gespeichert werden.';
        showToast(rulesError, 'error');
      } finally {
        rulesSaving = false;
        if (rulesJSON !== snapshot && rulesJSON !== savedRules) {
          rulesStatus = 'pending';
          rulesTimer = setTimeout(saveRulesNow, 0);
        }
      }
    };
  };
  function updateAdjustmentStatus() {
    const { month, value } = adjustmentDraft;
    adjustmentStatus = !Number.isFinite(value)
      ? 'invalid'
      : failedAdjustments.get(month) === value
        ? 'error'
        : adjustmentQueue.has(month)
          ? adjustmentSaving
            ? 'saving'
            : 'pending'
          : 'saved';
  }
  function scheduleAdjustment() {
    if (adjustmentTimer) clearTimeout(adjustmentTimer);
    if (adjustmentSaving || !adjustmentQueue.size) return;
    const due = Math.min(...[...adjustmentQueue.values()].map(item => item.due));
    adjustmentTimer = setTimeout(sendQueuedAdjustment, Math.max(0, due - Date.now()));
  }
  function changeAdjustment(event: Event) {
    const input = event.target as HTMLInputElement;
    const amount = input.value === '' ? undefined : input.valueAsNumber;
    const month = adjustmentDraft.month;
    adjustmentDraft = { month, value: amount as number };
    adjustmentDrafts.set(month, amount);
    failedAdjustments.delete(month);
    if (Number.isFinite(amount) && input.validity.valid) {
      adjustmentQueue.set(month, { value: amount!, due: Date.now() + 650 });
    } else adjustmentQueue.delete(month);
    updateAdjustmentStatus();
    scheduleAdjustment();
  }
  function saveAdjustmentNow() {
    if (Number.isFinite(adjustmentDraft.value)) {
      failedAdjustments.delete(adjustmentDraft.month);
      adjustmentQueue.set(adjustmentDraft.month, { value: adjustmentDraft.value, due: Date.now() });
      scheduleAdjustment();
      updateAdjustmentStatus();
    }
  }
  function sendQueuedAdjustment() {
    if (adjustmentSaving || !adjustmentForm) return;
    const queued = [...adjustmentQueue].sort((a, b) => a[1].due - b[1].due)[0];
    if (!queued) return;
    if (queued[1].due > Date.now()) {
      scheduleAdjustment();
      return;
    }
    const [month, item] = queued;
    (adjustmentForm.elements.namedItem('month') as HTMLInputElement).value = month;
    (adjustmentForm.elements.namedItem('adjustmentHours') as HTMLInputElement).value = String(item.value);
    adjustmentForm.requestSubmit();
  }
  const saveAdjustment: SubmitFunction = ({ formData, cancel }) => {
    if (adjustmentSaving) {
      cancel();
      return;
    }
    const month = String(formData.get('month'));
    const raw = String(formData.get('adjustmentHours') ?? '');
    const amount = Number(raw);
    if (!raw || !Number.isFinite(amount) || !/^\d{4}-\d{2}$/.test(month)) {
      cancel();
      return;
    }
    adjustmentSaving = true;
    updateAdjustmentStatus();
    showToast('Monatskorrektur wird gespeichert …', 'saving');
    return async ({ result: response, update }) => {
      try {
        const payload =
          response.type === 'success' || response.type === 'failure'
            ? (response.data as Record<string, unknown>)
            : null;
        if (response.type !== 'success' || payload?.error)
          throw new Error(String(payload?.error || 'Monatskorrektur konnte nicht gespeichert werden.'));
        savedAdjustments[month] = amount;
        failedAdjustments.delete(month);
        if (adjustmentQueue.get(month)?.value === amount) adjustmentQueue.delete(month);
        await update({ reset: false });
        showToast(`Monatskorrektur für ${monthLabel(month)} gespeichert`, 'success');
      } catch (e) {
        if (adjustmentQueue.get(month)?.value === amount) {
          adjustmentQueue.delete(month);
          failedAdjustments.set(month, amount);
        }
        showToast(e instanceof Error ? e.message : 'Speichern fehlgeschlagen', 'error');
      } finally {
        adjustmentSaving = false;
        updateAdjustmentStatus();
        scheduleAdjustment();
      }
    };
  };
  const submit: SubmitFunction = ({ formElement }) => {
    busy = true;
    error = '';
    success = '';
    const action = new URL(formElement.action).search;
    return async ({ result: response, update }) => {
      try {
        if (response.type === 'error') {
          error = 'Die Anfrage ist fehlgeschlagen. Deine Eingaben bleiben erhalten; bitte erneut versuchen.';
          return;
        }
        const payload =
          response.type === 'success' || response.type === 'failure'
            ? (response.data as Record<string, unknown>)
            : null;
        if (payload?.error) error = String(payload.error);
        if (payload?.success) {
          success = String(payload.success);
          showToast(success, 'success');
        }
        if (payload?.error) showToast(String(payload.error), 'error');
        if (action.includes('preview')) {
          uploadErrors = Array.isArray(payload?.uploadErrors)
            ? (payload.uploadErrors as { name: string; error: string }[])
            : [];
          uploadedMonths = Array.isArray(payload?.uploadMonths) ? (payload.uploadMonths as string[]) : [];
        }
        await update({ reset: false });
        if (payload?.saved && action.includes('entry')) entry = freshEntry();
      } finally {
        busy = false;
        deleteId = null;
      }
    };
  };
  function addOnDay(date: string) {
    entry = freshEntry(date);
    timeTrackingOpened = true;
    tab = 'Zeiterfassung';
  }
  function changeMonth(e: Event) {
    const m = (e.target as HTMLInputElement).value;
    if (/^\d{4}-\d{2}$/.test(m)) goto(`?month=${m}`, { keepFocus: true });
  }
  function changeYear(year: number) {
    if (Number.isInteger(year) && year >= 2000 && year <= 2099)
      goto(`?month=${year}-${data.month.slice(5)}`, { keepFocus: true });
  }
  function openMonth(month: string) {
    tab = 'Monat';
    goto(`?month=${month}&tab=Monat`, { keepFocus: true });
  }
  function shiftMonth(step: number) {
    const [y, m] = data.month.split('-').map(Number);
    goto(`?month=${new Date(Date.UTC(y, m - 1 + step, 1)).toISOString().slice(0, 7)}`);
  }
  function editEntry(e: Entry) {
    entry = structuredClone(e);
    entry.meta ??= {};
    timeTrackingOpened = true;
    tab = 'Zeiterfassung';
    document.getElementById('entry-form')?.scrollIntoView({ behavior: 'smooth' });
  }
</script>

<svelte:head
  ><title>Zeitklar · {tab === 'Übersicht' ? `Jahresübersicht ${data.month.slice(0, 4)}` : monthLabel(data.month)}</title
  ><meta
    name="description"
    content="Persönliche Prüfung von Zeitnachweisen, Bereitschaftsdiensten und Zuschlägen."
  /></svelte:head
>

<div class="shell">
  <form
    class="autosave-form"
    bind:this={rulesForm}
    action="?/rules"
    method="POST"
    use:enhance={saveSettings}
    aria-hidden="true"
  >
    <input type="hidden" name="rules" value={rulesJSON} /><input type="hidden" name="month" value={rulesMonth} />
  </form>
  <form
    class="autosave-form"
    bind:this={adjustmentForm}
    action="?/month-settings"
    method="POST"
    use:enhance={saveAdjustment}
    aria-hidden="true"
  >
    <input type="hidden" name="month" value={adjustmentDraft.month} /><input
      type="hidden"
      name="adjustmentHours"
      value={adjustmentDraft.value}
    />
  </form>
  {#if toast}<div class={`save-toast ${toast.tone}`} role="status" aria-live="polite">
      <span class="toast-icon" aria-hidden="true"
        >{toast.tone === 'success' ? '✓' : toast.tone === 'error' ? '!' : '◌'}</span
      ><span>{toast.message}</span>{#if toast.tone === 'error' && rulesStatus === 'error'}<button onclick={saveRulesNow}
          >Erneut versuchen</button
        >{:else if toast.tone !== 'saving'}<button
          class="toast-close"
          aria-label="Meldung schließen"
          onclick={() => (toast = null)}>×</button
        >{/if}
    </div>{/if}
  {#if data.authWarning && !localMode}<div class="auth-warning" role="alert">
      <strong>Kein Passwort gesetzt.</strong><span
        >Die App ist ohne Anmeldung erreichbar. Für Zugriff außerhalb des lokalen Rechners <code>APP_PASSWORD</code> setzen
        und einen HTTPS-Reverse-Proxy vorschalten.</span
      >
    </div>{/if}
  <aside class="sidebar">
    <a class="brand" href={localMode ? './' : '/'} aria-label="Zeitklar Startseite"
      ><span class="brand-mark">z<span>·</span></span><span>Zeitklar<small>DEINE ZEIT. IM BLICK.</small></span></a
    >
    <div class="workspace-label">PERSÖNLICHER ARBEITSBEREICH</div>
    <nav aria-label="Hauptnavigation">
      {#each tabs as item, i}<button
          class:active={tab === item}
          onclick={() => openTab(item)}
          aria-label={item === 'Abgleich' && reviewMonths.length
            ? `Abgleich, ${reviewMonths.length} ${reviewMonths.length === 1 ? 'Monat' : 'Monate'} mit offenen Prüfpunkten`
            : item}
          ><span class="nav-icon" aria-hidden="true"
            >{#if item === 'Zeiterfassung'}<svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
                style="vertical-align:middle"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg
              >{:else}{['▥', '◫', '▦', '↥', '', '⇄', '⚙'][i]}{/if}</span
          >{item}{#if item === 'Abgleich' && reviewMonths.length}<span
              class="nav-count"
              title="Monate mit offenen Prüfpunkten">{reviewMonths.length}</span
            >{/if}</button
        >{/each}
    </nav>
    <div class="sidebar-bottom">
      <span class="local-dot"></span> Lokal
      <p>{localMode ? 'Deine Nachweise bleiben in diesem Browser.' : 'Deine Nachweise bleiben auf deinem Server.'}</p>
      <a href="/api/export" class="text-link">Daten exportieren ↗</a>
      {#if !localMode}
        <form class="restore-form" action="?/restore" method="POST" enctype="multipart/form-data" use:enhance={submit}>
          <label class="text-link"
            >Sicherung einlesen<input
              type="file"
              name="backup"
              accept=".json,application/json"
              disabled={busy}
              onchange={event => event.currentTarget.form?.requestSubmit()}
            /></label
          >
        </form>
      {/if}
    </div>
  </aside>
  <main>
    <div class="content">
      <div class="page-heading">
        <div>
          <p class="eyebrow">
            {tab === 'Übersicht'
              ? 'DEIN JAHRESÜBERBLICK'
              : tab === 'Monat'
                ? 'DEIN MONATSÜBERBLICK'
                : 'DEIN ARBEITSBEREICH'}
          </p>
          <h1>
            {tab === 'Übersicht'
              ? `Jahresübersicht ${data.month.slice(0, 4)}`
              : tab === 'Monat'
                ? monthLabel(data.month)
                : tab}
          </h1>
          {#if tab !== 'Upload' && tab !== 'Zeiterfassung' && tab !== 'Monat' && tab !== 'Abgleich'}<p class="subtitle">
              {tab === 'Übersicht'
                ? 'Zeitkonto, Dienste und Zusatzvergütung im Jahresverlauf.'
                : tab === 'Kalender'
                  ? 'Dienstplan und eigene Zeiten im Monatskalender.'
                  : 'Deine Arbeitszeit und tariflichen Berechnungsgrundlagen.'}
            </p>{/if}
        </div>
        <div class="month-picker">
          {#if tab === 'Übersicht'}<button
              onclick={() => changeYear(Number(data.month.slice(0, 4)) - 1)}
              disabled={Number(data.month.slice(0, 4)) <= 2000}
              aria-label="Vorheriges Jahr">‹</button
            ><input
              type="number"
              min="2000"
              max="2099"
              step="1"
              aria-label="Auswertungsjahr"
              value={Number(data.month.slice(0, 4))}
              onchange={event => changeYear(event.currentTarget.valueAsNumber)}
            /><button
              onclick={() => changeYear(Number(data.month.slice(0, 4)) + 1)}
              disabled={Number(data.month.slice(0, 4)) >= 2099}
              aria-label="Nächstes Jahr">›</button
            >{:else}<button onclick={() => shiftMonth(-1)} aria-label="Vorheriger Monat">‹</button><input
              type="month"
              aria-label="Auswertungsmonat"
              value={data.month}
              onchange={changeMonth}
            /><button onclick={() => shiftMonth(1)} aria-label="Nächster Monat">›</button>{/if}
        </div>
      </div>
      <div aria-live="polite">
        {#if error}<div class="notice danger" role="alert">{error}</div>{/if}{#if success}<div class="notice good">
            {success}
          </div>{/if}{#if busy}<div class="working">Wird verarbeitet …</div>{/if}
      </div>

      {#key data.month}
        {#if tab === 'Übersicht'}
          <YearOverview {data} onmonth={openMonth} />
        {:else if tab === 'Monat'}
          <MonthTab {data} {view} {openTab} />
        {:else if tab === 'Kalender'}
          <Calendar
            duties={data.rules.dutyTemplates}
            rules={data.rules}
            month={data.month}
            report={data.report}
            entries={data.entries}
            holidays={calendarHolidays}
            {submit}
            {busy}
            onAdd={addOnDay}
            onEdit={editEntry}
          />
        {:else if tab === 'Upload'}
          <UploadTab {data} {busy} {submit} {uploadErrors} {uploadedMonths} bind:entryImportDrafts />
        {:else if tab === 'Zeiterfassung'}
          <TimeTrackingTab {data} {view} {busy} {submit} {editEntry} bind:entry bind:deleteId />
        {:else if tab === 'Abgleich'}
          <ReviewTab {data} {view} {busy} {submit} {openTab} {openReviewMonth} bind:settlement />
        {:else if tab === 'Einstellungen'}
          <SettingsTab
            {data}
            {busy}
            {submit}
            {rulesMonth}
            selectMonth={month => goto(`?month=${month}`, { keepFocus: true })}
            bind:rules
            bind:holidayText
            {rulesStatus}
            {rulesError}
            {saveRulesNow}
            {adjustmentDraft}
            {adjustmentStatus}
            {changeAdjustment}
            {saveAdjustmentNow}
          />
        {/if}
      {/key}
    </div>
  </main>
</div>
