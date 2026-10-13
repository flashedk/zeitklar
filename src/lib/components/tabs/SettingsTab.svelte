<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { euro, hours } from '$lib/calculate';
  import { dateLabel, monthLabel, rateLabel, value } from '$lib/format';
  import { federalStates, getHolidays } from '$lib/holidays';
  import { stageCount, tariffProfile } from '$lib/tariff';
  import { versionRange, type Rules } from '$lib/model';
  import type { WorkspaceData } from '$lib/workspace';
  import DutySettings from '../DutySettings.svelte';

  type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'invalid';
  let {
    data,
    busy,
    submit,
    rulesMonth,
    selectMonth,
    rules = $bindable(),
    holidayText = $bindable(),
    rulesStatus,
    rulesError,
    saveRulesNow,
    adjustmentDraft,
    adjustmentStatus,
    changeAdjustment,
    saveAdjustmentNow
  }: {
    data: WorkspaceData;
    busy: boolean;
    submit: SubmitFunction;
    /** The month whose profile version the editor currently shows and saves. */
    rulesMonth: string;
    selectMonth: (month: string) => void;
    rules: Rules;
    holidayText: string;
    rulesStatus: SaveStatus;
    rulesError: string;
    saveRulesNow: () => void;
    adjustmentDraft: { month: string; value: number };
    adjustmentStatus: SaveStatus;
    changeAdjustment: (event: Event) => void;
    saveAdjustmentNow: () => void;
  } = $props();
  const tariffPreview = $derived(tariffProfile(rules, data.month));
  const holidayPreview = $derived(
    getHolidays(Number(data.month.slice(0, 4)), rules.federalState, {
      assumption: rules.localAssumption,
      augsburg: rules.localAugsburg,
      corpusChristi: rules.localCorpusChristi
    })
  );
  type Range = { from: string | null; until: string | null };
  const range = $derived(versionRange(data.rules, rulesMonth));
  const versions = $derived<Range[]>([
    ...(data.rules.previous ?? []).map((version, index) => ({
      from: index ? versionRange(data.rules, version.validUntil).from : null,
      until: version.validUntil
    })),
    ...(data.rules.previous?.length ? [versionRange(data.rules, '9999-12')] : [])
  ]);
  const rangeText = ({ from, until }: Range) =>
    from && until
      ? `von ${monthLabel(from)} bis ${monthLabel(until)}`
      : from
        ? `ab ${monthLabel(from)}`
        : until
          ? `bis ${monthLabel(until)}`
          : 'für alle Monate';
  // Version changes wait until pending edits are saved, so they never apply to the wrong version.
  const versionLocked = $derived(busy || rulesStatus !== 'saved' || rulesMonth !== data.month);
  function changeGroup(event: Event) {
    rules.group = (event.target as HTMLSelectElement).value as Rules['group'];
    rules.stage = Math.min(rules.stage ?? 1, stageCount(rules.group));
    if (rules.stage === stageCount(rules.group)) rules.nextAdvanceDate = '';
  }
  function changeStage(event: Event) {
    rules.stage = Number((event.target as HTMLSelectElement).value);
    if (rules.stage === stageCount(rules.group)) rules.nextAdvanceDate = '';
  }
</script>

<DutySettings bind:duties={rules.dutyTemplates} />
<section class="panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">ZEITKONTO · {monthLabel(data.month)}</p>
      <h2>Zeitkontokorrektur für diesen Monat</h2>
    </div>
  </div>
  <label
    >Zeitkontokorrektur (h)<input
      type="number"
      step="0.01"
      value={adjustmentDraft.value}
      oninput={changeAdjustment}
    /><small
      >Gilt ausschließlich für {monthLabel(data.month)}. Positive Werte addieren Stunden, negative Werte ziehen Stunden
      ab.</small
    ></label
  >
  <p class="small-note" aria-live="polite">
    {adjustmentStatus === 'saved'
      ? '✓ Monatskorrektur gespeichert'
      : adjustmentStatus === 'invalid'
        ? 'Bitte einen gültigen Stundenwert eingeben.'
        : adjustmentStatus === 'error'
          ? 'Speichern fehlgeschlagen.'
          : 'Monatskorrektur wird automatisch gespeichert …'}
  </p>
  {#if adjustmentStatus === 'error'}<button class="secondary" onclick={saveAdjustmentNow}>Erneut speichern</button>{/if}
</section>
<div class="settings-editor">
  <div class="settings-save-status" aria-live="polite">
    <span class:unsaved={rulesStatus !== 'saved'}
      >{rulesStatus === 'saved'
        ? '✓ Alle Einstellungen gespeichert'
        : rulesStatus === 'pending'
          ? 'Änderungen werden gleich gespeichert …'
          : rulesStatus === 'saving'
            ? 'Einstellungen werden gespeichert …'
            : rulesStatus === 'invalid'
              ? 'Bitte Eingaben vervollständigen'
              : 'Speichern fehlgeschlagen'}</span
    >
    <p>Einstellungen werden automatisch gespeichert. Du brauchst keinen Speichern-Button.</p>
    {#if rulesError}<p class="settings-error">{rulesError}</p>{/if}{#if rulesStatus === 'error'}<button
        class="secondary"
        onclick={saveRulesNow}>Erneut speichern</button
      >{/if}
  </div>
  <section class="panel profile-versions" aria-label="Gültigkeit der Einstellungen">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">GÜLTIGKEIT · {monthLabel(rulesMonth)}</p>
        <h2>Fassung der Einstellungen</h2>
      </div>
      <span class="badge neutral">{Math.max(versions.length, 1)} {versions.length > 1 ? 'Fassungen' : 'Fassung'}</span>
    </div>
    <p>Die Einstellungen auf dieser Seite gelten <strong>{rangeText(range)}</strong>.</p>
    {#if versions.length > 1}<div class="version-list">
        {#each versions as version}<button
            type="button"
            class:current={version.from === range.from && version.until === range.until}
            onclick={() => selectMonth(version.from ?? version.until!)}>{rangeText(version)}</button
          >{/each}
      </div>{/if}
    {#if range.from === data.month}<form action="?/rules-version" method="POST" use:enhance={submit}>
        <input type="hidden" name="month" value={data.month} /><input
          type="hidden"
          name="operation"
          value="merge"
        /><button class="secondary" disabled={versionLocked}>Mit der vorherigen Fassung zusammenführen</button>
      </form>
      <p class="small-note">
        Beim Zusammenführen entfällt die vorherige Fassung; diese Werte gelten dann auch für die früheren Monate.
      </p>
    {:else}<form action="?/rules-version" method="POST" use:enhance={submit}>
        <input type="hidden" name="month" value={data.month} /><input
          type="hidden"
          name="operation"
          value="split"
        /><button class="secondary" disabled={versionLocked}>Ab {monthLabel(data.month)} neue Fassung anlegen</button>
      </form>
      <p class="small-note">
        Eine neue Fassung übernimmt zunächst alle Werte. Änderungen daran gelten erst ab {monthLabel(data.month)};
        frühere Monate und ihre Quittierungen bleiben unverändert.
      </p>
    {/if}
    <p class="small-note">Anfangsstand, Dienstvorlagen und die Profilbestätigung gelten immer für alle Monate.</p>
  </section>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">ZEITKONTO</p>
        <h2>Einmaliger Anfangsstand</h2>
      </div>
    </div>
    <div class="form-grid">
      <label
        >Anfangsstand Zeitkonto (h)<input
          type="number"
          step="0.01"
          bind:value={rules.openingHours}
          oninput={() => {
            rules.openingHoursEntered = true;
            if (!rules.openingMonth) rules.openingMonth = [...data.months, data.month].sort()[0];
          }}
        /></label
      ><label
        >Anfangsstand gilt ab<input
          type="month"
          bind:value={rules.openingMonth}
          oninput={event => (rules.openingHoursEntered = !!(event.target as HTMLInputElement).value)}
        /></label
      >
    </div>
    <p class="small-note">
      Einmalig den Stand zu Beginn dieses Monats hinterlegen. Anfangsstände aus dem Nachweis haben Vorrang. Für spätere
      Monate wird der Schlussstand des Vormonats übernommen.
    </p>
  </section>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">TARIFPROFIL</p>
        <h2>TV-Ärzte / TdL</h2>
      </div>
      <span class="badge neutral">Zeitabhängige Entgelttabellen</span>
    </div>
    <div class="form-grid">
      <label
        >Entgeltgruppe<select bind:value={rules.group} onchange={changeGroup}
          ><option value="1">Ä 1 · Arzt / Ärztin</option><option value="2">Ä 2 · Facharzt / Fachärztin</option><option
            value="3">Ä 3 · Oberarzt / Oberärztin</option
          ><option value="4">Ä 4 · Leitende Oberärztin / leitender Oberarzt</option></select
        ></label
      >
      <label
        >Entgeltstufe<select bind:value={rules.stage} onchange={changeStage}
          >{#each Array.from({ length: stageCount(rules.group) }, (_, i) => i + 1) as stage}<option value={stage}
              >Stufe {stage}</option
            >{/each}</select
        ></label
      >
      <label
        >Nächster Stufenaufstieg<input
          type="date"
          bind:value={rules.nextAdvanceDate}
          disabled={rules.stage === stageCount(rules.group)}
        /><small
          >{rules.stage === stageCount(rules.group)
            ? 'Höchste Stufe erreicht.'
            : 'Datum des nächsten Aufstiegs. Bis zu diesem Monat gilt die ausgewählte Stufe.'}</small
        ></label
      >
      <label
        >Stundenentgelt bestimmen<select bind:value={rules.rateMode}
          ><option value="table">Aus Entgelttabelle</option><option value="manual">Manuell</option></select
        ><small>Bestehende manuelle Stundensätze bleiben gespeichert.</small></label
      >
      {#if rules.rateMode === 'manual'}
        <label
          >Individuelles Stundenentgelt (€)<input
            type="number"
            min="0"
            step="0.01"
            bind:value={rules.individualRate}
          /><small>Für Bereitschaftsdienst und Rufbereitschaft</small></label
        >
        <label
          >Überstunden-Grundvergütung pro Stunde (€)<input
            type="number"
            min="0"
            step="0.01"
            bind:value={rules.overtimeBaseRate}
          /><small>Individuelles Stundenentgelt, tariflich höchstens Stufe 4</small></label
        >
      {/if}
    </div>
    <p class="small-note">
      Die neue Stufe gilt für den ganzen Monat des Aufstiegs. Mit einem nächsten Aufstiegsdatum werden frühere und
      kommende Stufen anhand der tariflichen Laufzeiten rekonstruiert. Das setzt ununterbrochene Zeiten in derselben
      Entgeltgruppe voraus; Unterbrechungen und abweichend anerkannte Zeiten bitte prüfen. Ohne Datum bleibt die
      ausgewählte Stufe fest.
    </p>
    <div class="tariff-preview-heading">
      <span class="badge">{monthLabel(data.month)}</span><strong>Wirksame Stufe {tariffPreview.stage}</strong
      >{#if tariffPreview.nextAdvance}<span>Nächster Aufstieg: {dateLabel(tariffPreview.nextAdvance)}</span>{:else}<span
          >Kein weiterer Aufstieg hinterlegt</span
        >{/if}
    </div>
    <div class="tariff-rates">
      <article>
        <span>Tabellenentgelt bei Vollzeit</span><strong
          >{rules.rateMode === 'manual'
            ? 'Manuelle Stundensätze'
            : tariffPreview.monthlyPay == null
              ? 'Tarifgrundlage fehlt'
              : euro(tariffPreview.monthlyPay)}</strong
        ><small
          >Ä {rules.group} · Stufe {tariffPreview.stage} · {hours(tariffPreview.fullWeeklyHours)} Wochenstunden</small
        >
      </article>
      <article>
        <span>Individuelles Stundenentgelt</span><strong>{rateLabel(tariffPreview.individualRate)}</strong><small
          >{rules.rateMode === 'manual'
            ? 'Manuelle Eingabe'
            : `Tabellenentgelt ÷ ${hours(tariffPreview.divisor)}`}</small
        >
      </article>
      <article>
        <span>Überstunden-Grundvergütung</span><strong>{rateLabel(tariffPreview.overtimeBaseRate)}</strong><small
          >{rules.rateMode === 'manual'
            ? 'Manuelle Eingabe · höchstens Stufe 4 prüfen'
            : 'Tabellenentgelt, höchstens Stufe 4'}</small
        >
      </article>
      <article>
        <span>Zuschlagsbasis · Stufe 3</span><strong>{rateLabel(tariffPreview.bonusRate)}</strong><small
          >Unabhängig von deiner Entgeltstufe</small
        >
      </article>
    </div>
    <p class="small-note">
      Nacht {data.month < '2024-04' ? '21' : '20'}–6 Uhr 20 %, Sonntag 25 %, Samstag 13–{data.month < '2024-04'
        ? '21'
        : '20'} Uhr 20 %, Überstunden 15 %. Feiertage abhängig vom Freizeitausgleich. Die passende Entgelttabelle und der
      Stundenteiler richten sich nach dem Dienstmonat und der geltenden Vollzeit-Wochenarbeitszeit.
    </p>
    {#if tariffPreview.warnings.length}<div class="notice warning">
        <ul class="warnings">
          {#each tariffPreview.warnings as warning}<li>{warning}</li>{/each}
        </ul>
      </div>{/if}
  </section>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">ARBEITSORT</p>
        <h2>Feiertage nach Bundesland</h2>
      </div>
    </div>
    <label
      >Feiertags-Freizeitausgleich<select bind:value={rules.holidayCompensated}
        ><option value={undefined}>Ungeklärt</option><option value={true}>Mit Freizeitausgleich (35 %)</option><option
          value={false}>Ohne Freizeitausgleich (135 %)</option
        ></select
      ><small>Gilt für eigene Arbeitszeiten. Bereits gespeicherte Angaben eines einzelnen Eintrags haben Vorrang.</small
      ></label
    ><label class="holiday-field"
      >Zusätzliche Feiertage<textarea
        rows="4"
        bind:value={holidayText}
        placeholder="2026-01-01&#10;2026-04-03&#10;Ein Datum pro Zeile, im Format JJJJ-MM-TT"
      ></textarea><small
        >Zusätzliche örtliche Feiertage eintragen. Landesfeiertage werden automatisch ergänzt. 24. und 31. Dezember
        berücksichtigt das Tarifprofil gesondert.</small
      ></label
    ><label
      >Bundesland des Arbeitsorts<select bind:value={rules.federalState}
        ><option value="">Bitte auswählen</option>{#each federalStates as state}<option value={state.code}
            >{state.name}</option
          >{/each}</select
      ></label
    >{#if rules.federalState === 'BY'}<label class="checkbox"
        ><input type="checkbox" bind:checked={rules.localAssumption} />Mariä Himmelfahrt gilt in meiner Arbeitsgemeinde</label
      ><label class="checkbox"
        ><input type="checkbox" bind:checked={rules.localAugsburg} />Arbeitsort Stadt Augsburg (Friedensfest)</label
      >{/if}{#if rules.federalState === 'SN' || rules.federalState === 'TH'}<label class="checkbox"
        ><input type="checkbox" bind:checked={rules.localCorpusChristi} />Fronleichnam gilt in meiner Arbeitsgemeinde</label
      >{/if}
    <p class="small-note">
      Landesweite Feiertage werden automatisch berechnet. Für örtliche Feiertage wähle die passende Ausnahme oder
      ergänze oben ein Datum.
    </p>
    {#if holidayPreview.length}<details>
        <summary>Feiertage {data.month.slice(0, 4)} ansehen ({holidayPreview.length})</summary>
        <div class="holiday-list">
          {#each holidayPreview as holiday}<span><b>{dateLabel(holiday.date)}</b>{holiday.name}</span>{/each}
        </div>
      </details>{/if}
  </section>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">ARBEITSZEITVERLAUF</p>
        <h2>Änderung der Wochenarbeitszeit</h2>
      </div>
    </div>
    <label class="checkbox"
      ><input type="checkbox" bind:checked={rules.workTimeChangeEnabled} /><span
        ><strong>Arbeitszeitänderung berücksichtigen</strong><small
          >Zum Beispiel der Wechsel von 42 auf 40 Wochenstunden.</small
        ></span
      ></label
    >{#if rules.workTimeChangeEnabled}<div class="form-grid">
        <label>Änderung ab<input type="date" bind:value={rules.workTimeChangeDate} /></label><label
          >Wochenstunden vorher<input
            type="number"
            min="1"
            max="168"
            step="0.25"
            bind:value={rules.weeklyHoursBefore}
          /></label
        ><label
          >Wochenstunden danach<input
            type="number"
            min="1"
            max="168"
            step="0.25"
            bind:value={rules.weeklyHoursAfter}
          /></label
        >
      </div>
      <p class="small-note">
        Das Wochenprofil unten legt die Verteilung auf die Wochentage fest. Die Stunden werden im selben Verhältnis auf
        die jeweils geltenden Wochenstunden angepasst. Ein Wechsel innerhalb eines Monats wird taggenau berücksichtigt;
        Feiertage bleiben arbeitsfrei. Ein individuell eingetragenes Monatssoll hat Vorrang.
      </p>{:else}<p class="small-note">Für alle Monate gilt die unten eingetragene Arbeitswoche.</p>{/if}
  </section>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">PERSÖNLICHE VEREINBARUNG</p>
        <h2>Opt-out</h2>
      </div>
    </div>
    <div class="form-grid">
      <label
        >Opt-out-Vereinbarung<select bind:value={rules.optOut}
          ><option value="unknown">Noch nicht hinterlegt</option><option value="no">Keine Opt-out-Vereinbarung</option
          ><option value="yes">Opt-out vereinbart</option></select
        ></label
      >{#if rules.optOut === 'yes'}<label
          >Vereinbarte Wochenstundengrenze<input
            type="number"
            min="0.01"
            max="168"
            step="0.01"
            bind:value={rules.optOutWeeklyHours}
            placeholder="Optional, laut Vereinbarung"
          /><small>Wochenstunden laut deiner Vereinbarung.</small></label
        >{/if}
    </div>
    <p class="small-note">
      Einmalig für dein Profil hinterlegen. Die Auswahl wird automatisch gespeichert und gilt unabhängig vom
      ausgewählten Monat.
    </p>
  </section>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">SOLLZEIT</p>
        <h2>Deine reguläre Arbeitswoche</h2>
      </div>
    </div>
    <p class="small-note">
      Das Wochenprofil dient der Berechnung eigener Einträge. Geplante und vertragliche Sollzeit im DPL-Nachweis können
      davon abweichen.
    </p>
    <div class="week-grid">
      {#each [1, 2, 3, 4, 5, 6, 0] as day}<label
          >{['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][day]}<input
            type="number"
            min="0"
            max="24"
            step="0.25"
            bind:value={rules.dailyHours[day]}
          /><small>Stunden</small></label
        >{/each}
    </div>
  </section>
  <section class="panel">
    <label class="checkbox confirmation"
      ><input type="checkbox" bind:checked={rules.confirmed} /><span
        ><strong>Ich habe mein Profil geprüft.</strong><small
          >Entgeltgruppe, Stundenentgelte, Sollzeit und Feiertage passen zu meiner Beschäftigung.</small
        ></span
      ></label
    >
    <p class="small-note">Änderungen werden automatisch übernommen, sobald alle Eingaben gültig sind.</p>
  </section>
</div>
