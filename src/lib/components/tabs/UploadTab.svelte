<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { kinds } from '$lib/model';
  import { dateLabel, monthLabel, value } from '$lib/format';
  import type { EntryPreview } from '$lib/upload';
  import type { WorkspaceData } from '$lib/workspace';

  let {
    data,
    busy,
    submit,
    uploadErrors,
    uploadedMonths,
    entryImportDrafts = $bindable()
  }: {
    data: WorkspaceData;
    busy: boolean;
    submit: SubmitFunction;
    uploadErrors: { name: string; error: string }[];
    uploadedMonths: string[];
    entryImportDrafts: Record<number, EntryPreview>;
  } = $props();
  const report = $derived(data.report);
  const pendingReports = $derived(data.pendingReports);
  const pendingEntryImports = $derived(data.pendingEntryImports);
  const pendingMonths = $derived([...new Set(pendingReports.map(item => item.report.period))].sort().reverse());
</script>

<section class="panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">DATEIIMPORT</p>
      <h2>Zeitnachweise hochladen</h2>
    </div>
    <span class="badge neutral">PDF / TXT</span>
  </div>
  <form action="?/preview" method="POST" enctype="multipart/form-data" use:enhance={submit} class="upload-form">
    <label class="upload-zone"
      ><span class="upload-icon" aria-hidden="true">↥</span><strong>Eine oder mehrere Dateien auswählen</strong><span
        >Bis zu 20 Dateien · maximal 10 MB pro Datei / 100 MB insgesamt</span
      ><input name="file" type="file" multiple accept=".pdf,.txt,application/pdf,text/plain" required /></label
    ><button class="primary" disabled={busy}>Dateien einlesen →</button>
  </form>
  <p class="small-note">
    Der Dienstmonat wird automatisch aus jedem Nachweis erkannt. Deine unbestätigten Nachweise bleiben gespeichert, bis
    du sie bestätigst oder verwirfst – auch beim Monatswechsel.
  </p>
  <details>
    <summary>TXT stattdessen einfügen</summary>
    <form action="?/paste-preview" method="POST" use:enhance={submit}>
      <label
        >Text des Zeitnachweises<textarea
          name="text"
          rows="8"
          maxlength="500000"
          required
          placeholder="Hier den vollständigen TXT-Zeitnachweis einfügen."
        ></textarea></label
      ><button class="primary" disabled={busy}>Text einlesen →</button>
    </form>
  </details>
</section>
{#if uploadedMonths.length}<div class="notice good">
    Dateien eingelesen für {uploadedMonths.map(monthLabel).join(', ')}. Prüfe und bestätige die Importvorschauen unten.
  </div>{/if}
{#if uploadErrors.length}<section class="panel">
    <div class="panel-heading">
      <h2>Diese Dateien brauchen eine Prüfung</h2>
      <span class="badge warning">{uploadErrors.length}</span>
    </div>
    {#each uploadErrors as item}<div class="upload-error">
        <strong>{item.name}</strong>
        <p>{item.error}</p>
      </div>{/each}
  </section>{/if}
{#if pendingReports.length}<div class="queue-heading">
    <div>
      <p class="eyebrow">DAUERHAFT GESPEICHERTE VORSCHAUEN</p>
      <h2>Nachweise zum Bestätigen</h2>
    </div>
    <span class="badge neutral">{pendingReports.length} offen</span>
  </div>
  {#each pendingMonths as pendingMonth}<section class="pending-month">
      <h3>{monthLabel(pendingMonth)}</h3>
      {#each pendingReports
        .filter(item => item.report.period === pendingMonth)
        .sort((a, b) => a.report.filename.localeCompare(b.report.filename)) as item (item.id)}
        <section class="panel preview-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">BETRIEBLICHER NACHWEIS · VORSCHAU</p>
              <h2>{item.report.filename}</h2>
            </div>
            <span class="badge">{monthLabel(item.report.period)}</span>
          </div>
          <div class="source-strip">
            <span>Dienstmonat <strong>{monthLabel(item.report.period)}</strong></span><span
              >Auswertung <strong>{dateLabel(item.report.printedAt)}</strong></span
            >
          </div>
          <div class="mini-stats">
            <div><span>Istzeit</span><strong>{value(item.report.totals.actualHours)}</strong></div>
            <div>
              <span>Vertragliches Soll</span><strong>{value(item.report.totals.contractualTarget)}</strong>
            </div>
            <div><span>Tageszeilen</span><strong>{item.report.days.length}</strong></div>
          </div>
          <p class="small-note">
            Bestätige die Angaben für {monthLabel(item.report.period)}. Der Nachweis wird genau diesem Monat zugeordnet;
            eigene Arbeitszeiten bleiben separat.
          </p>
          {#if item.report.warnings.length}<details open>
              <summary>Importhinweise ({item.report.warnings.length})</summary>
              <ul class="warnings">
                {#each item.report.warnings as warning}<li>{warning}</li>{/each}
              </ul>
            </details>{/if}
          <details>
            <summary>Tageswerte und Dienste prüfen</summary>
            <div class="table-scroll">
              <table>
                <thead><tr><th>Datum</th><th>Dienst</th><th>Soll</th><th>Ist</th><th>BD</th><th>Nacht</th></tr></thead
                ><tbody
                  >{#each item.report.days as day}<tr
                      ><td>{dateLabel(day.date)}</td><td
                        >{#each day.spans as span}<div class="span-line">
                            {span.label} · {span.start}–{span.end}{span.kind === 'unknown' ? ' · ungeklärt' : ''}
                          </div>{/each}</td
                      ><td>{value(day.plannedHours)}</td><td>{value(day.actualHours)}</td><td
                        >{value(day.standbyHours)}</td
                      ><td>{value(day.nightHours)}</td></tr
                    >{/each}</tbody
                >
              </table>
            </div>
          </details>
          <details>
            <summary>Originaltext ansehen</summary>
            <pre class="raw-text">{item.report.rawText}</pre>
          </details>
          <div class="queue-actions">
            <form action="?/confirm" method="POST" use:enhance={submit}>
              <input type="hidden" name="reportId" value={item.id} /><button class="primary" disabled={busy}
                >Nachweis bestätigen ✓</button
              >
            </form>
            <form action="?/discard" method="POST" use:enhance={submit}>
              <input type="hidden" name="reportId" value={item.id} /><button class="secondary" disabled={busy}
                >Vorschau verwerfen</button
              >
            </form>
          </div>
        </section>
      {/each}
    </section>{/each}
{:else}<p class="small-note">
    Keine unbestätigten betrieblichen Nachweise vorhanden. Neue Uploads erscheinen hier, unabhängig vom ausgewählten
    Auswertungsmonat.
  </p>{/if}
{#if pendingEntryImports.length}<div class="queue-heading">
    <div>
      <p class="eyebrow">DAUERHAFT GESPEICHERTE IMPORTVORSCHAUEN</p>
      <h2>Eigene Einträge zum Bestätigen</h2>
    </div>
    <span class="badge neutral">{pendingEntryImports.length} Dateien</span>
  </div>
  {#each pendingEntryImports as item (item.id)}{@const draft = entryImportDrafts[item.id] ?? item.preview}
    <section class="panel preview-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">EIGENE ZEITEN · IMPORTVORSCHAU</p>
          <h2>{draft.filename}</h2>
        </div>
        <span class="badge neutral">{draft.entries.length} Einträge</span>
      </div>
      <p class="small-note">
        Dienstmonate: {[...new Set(draft.entries.map(entry => entry.date.slice(0, 7)))].map(monthLabel).join(', ')}. Die
        eingelesene Quelle bleibt bis zur Bestätigung gespeichert. Korrekturen in dieser Vorschau werden beim Bestätigen
        übernommen; ein Monatswechsel setzt Korrekturen zurück.
      </p>
      <div class="table-scroll">
        <table class="editable-table">
          <thead><tr><th>Datum</th><th>Art</th><th>Beginn</th><th>Ende</th><th>Pause (min)</th><th></th></tr></thead
          ><tbody
            >{#each draft.entries as e, i}<tr
                ><td
                  ><input
                    type="date"
                    aria-label={`Datum Import ${item.id}, Eintrag ${i + 1}`}
                    bind:value={e.date}
                  /></td
                ><td
                  ><select aria-label={`Art Import ${item.id}, Eintrag ${i + 1}`} bind:value={e.kind}
                    >{#each Object.entries(kinds) as [key, label]}<option value={key}>{label}</option>{/each}</select
                  ></td
                ><td
                  ><input
                    type="time"
                    aria-label={`Beginn Import ${item.id}, Eintrag ${i + 1}`}
                    bind:value={e.start}
                  /></td
                ><td
                  ><input type="time" aria-label={`Ende Import ${item.id}, Eintrag ${i + 1}`} bind:value={e.end} /></td
                ><td
                  ><input
                    type="number"
                    min="0"
                    aria-label={`Pause Import ${item.id}, Eintrag ${i + 1}`}
                    bind:value={e.breakMinutes}
                  /></td
                ><td
                  ><button
                    class="icon-button"
                    aria-label={`Eintrag ${i + 1} aus Import ${item.id} entfernen`}
                    onclick={() => {
                      if (entryImportDrafts[item.id])
                        entryImportDrafts[item.id].entries = entryImportDrafts[item.id].entries.filter(
                          (_, index) => index !== i
                        );
                    }}>×</button
                  ></td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div>
      {#if draft.warnings.length}<details open>
          <summary>Importhinweise ({draft.warnings.length})</summary>
          <ul class="warnings">
            {#each draft.warnings as warning}<li>{warning}</li>{/each}
          </ul>
        </details>{/if}
      <details>
        <summary>Originaltext ansehen</summary>
        <pre class="raw-text">{draft.text}</pre>
      </details>
      <div class="queue-actions">
        <form action="?/confirm-entries" method="POST" use:enhance={submit}>
          <input type="hidden" name="importId" value={item.id} /><input
            type="hidden"
            name="entries"
            value={JSON.stringify(draft.entries)}
          /><button class="primary" disabled={busy || !draft.entries.length}>Einträge bestätigen ✓</button>
        </form>
        <form action="?/discard-entries" method="POST" use:enhance={submit}>
          <input type="hidden" name="importId" value={item.id} /><button class="secondary" disabled={busy}
            >Importvorschau verwerfen</button
          >
        </form>
      </div>
    </section>{/each}{/if}
{#if report}<section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">GESPEICHERTE QUELLE</p>
        <h2>{report.filename}</h2>
      </div>
      <span class="badge">{monthLabel(report.period)}</span>
    </div>
    <p class="small-note">
      Auswertung vom {dateLabel(report.printedAt)}. Alle Stundenwerte in dieser Tabelle stammen aus dem Nachweis.
    </p>
    <div class="table-scroll">
      <table>
        <thead
          ><tr
            ><th>Tag</th><th>Dienst / Uhrzeit</th><th>Soll</th><th>Ist</th><th>BD</th><th>BD bewertet</th><th>Nacht</th
            ><th>So / FT</th></tr
          ></thead
        ><tbody
          >{#each report.days as day}<tr
              ><td><strong>{dateLabel(day.date).slice(0, 5)}</strong><small>{day.label}</small></td><td
                >{#each day.spans as span}<div class="span-line">
                    {span.label} <span>{span.start}–{span.end}</span>
                  </div>{/each}{#if !day.spans.length}—{/if}</td
              ><td>{value(day.plannedHours, '')}</td><td>{value(day.actualHours, '')}</td><td
                >{value(day.standbyHours, '')}</td
              ><td>{value(day.standbyWeightedHours, '')}</td><td>{value(day.nightHours, '')}</td><td
                >{value(day.sundayHours, '')} / {value(day.holidayHours, '')}</td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
    <details>
      <summary>Summen und Lohnarten des Betriebs</summary>
      <div class="two-columns">
        <div class="metric-list">
          {#each Object.entries(report.totals) as [key, n]}<div>
              <span
                >{(
                  {
                    openingBalance: 'Guthaben alt',
                    actualHours: 'Istzeit',
                    contractualTarget: 'Vertragliche Sollzeit',
                    plannedTarget: 'Geplante Sollzeit',
                    closingBalance: 'Guthaben neu',
                    monthlyBalance: 'Monatssaldo',
                    bdCount: 'Anzahl BD',
                    bdHours: 'BD-Stunden',
                    bdFactoredBuild: 'Fakt. BD Aufbau',
                    bdFactoredTotal: 'Fakt. BD gesamt',
                    healthHours: 'Arbeitsschutzkonto',
                    holidayBalance: 'Feiertagskonto',
                    optOut: 'Opt-Out'
                  } as Record<string, string>
                )[key] ?? key}</span
              ><strong>{value(n, key === 'bdCount' ? 'count' : 'h')}</strong>
            </div>{/each}
        </div>
        <div class="metric-list">
          {#each Object.entries(report.wageTypes) as [key, n]}<div>
              <span
                >{(
                  {
                    night: 'Nacht Regeldienst',
                    nightStandby: 'Nacht aus BD',
                    nightTotal: 'Nacht gesamt',
                    saturday: 'Samstag',
                    sunday: 'Sonntag',
                    holiday35: 'Feiertag 35 %',
                    holiday100: 'Feiertag 100 %',
                    holiday135: 'Feiertag 135 %',
                    overtimeBase: 'Überstunden Grundvergütung',
                    overtimeBonus: 'Überstunden Zuschlag',
                    shiftAllowance: 'Schichtzulage'
                  } as Record<string, string>
                )[key] ?? key}</span
              ><strong>{value(n, key === 'shiftAllowance' ? 'EUR' : 'h')}</strong>
            </div>{/each}
        </div>
      </div>
    </details>
    {#if report.transfers.length}<details>
        <summary>Zeitumbuchungen</summary>{#each report.transfers as transfer}<div class="issue">
            <strong>{dateLabel(transfer.date)}</strong><span>{transfer.label}</span><b>{value(transfer.hours)}</b>
          </div>{/each}
      </details>{/if}
    <details>
      <summary>Originaltext des Nachweises</summary>
      <pre class="raw-text">{report.rawText}</pre>
    </details>
  </section>{/if}
