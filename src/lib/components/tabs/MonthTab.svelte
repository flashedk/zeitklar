<script lang="ts">
  import { euro, hours } from '$lib/calculate';
  import { dateLabel, monthLabel, statCount, statHours, value } from '$lib/format';
  import { monthStatistics } from '$lib/month-statistics';
  import type { MonthView } from '$lib/month-view';
  import type { WorkspaceData } from '$lib/workspace';
  import IssueInformation from '../IssueInformation.svelte';

  let { data, view, openTab }: { data: WorkspaceData; view: MonthView; openTab: (tab: string) => void } = $props();
  const {
    report,
    result,
    audit,
    sickness,
    continuedLines,
    ownTotalPay,
    combinedAuditPay,
    informationalIssues,
    employerIssues,
    employerChecks,
    paymentCount,
    paymentAcknowledged,
    flags
  } = $derived(view);
  const monthStats = $derived(monthStatistics(data.month, data.entries, result, report, audit, sickness));
  const reported = (key: string) => report?.totals[key] ?? null;
</script>

{#if !report && !result.rows.length && !continuedLines.length}
  <section class="empty-state">
    <div class="empty-symbol" aria-hidden="true">↥</div>
    <p class="eyebrow">DER ERSTE SCHRITT</p>
    <h2>Mach deinen Zeitnachweis lesbar.</h2>
    <p>
      Importiere den monatlichen Nachweis aus deinem Betrieb. Zeitklar ordnet ihn dem Dienstmonat zu – auch wenn die
      Auswertung erst zwei Monate später kommt.
    </p>
    <button class="primary" onclick={() => openTab('Upload')}>Zeitnachweis importieren <span>↗</span></button>
    <div class="empty-steps">
      <span><b>01</b> Datei einlesen</span><span><b>02</b> Angaben prüfen</span><span
        ><b>03</b> Zuschläge abgleichen</span
      >
    </div>
  </section>
{:else}
  {#if report}<div class="source-strip">
      <span class="badge">BETRIEBLICHER NACHWEIS</span><span
        >Dienstmonat <strong>{monthLabel(report.period)}</strong></span
      ><span>Auswertung vom <strong>{dateLabel(report.printedAt)}</strong></span><button
        class="text-link"
        onclick={() => openTab('Upload')}>Quelle ansehen ↗</button
      >
    </div>{/if}
  {#if flags === 0 && employerChecks.length}<div class="review-complete compact">
      <span class="check-icon ok" aria-hidden="true">✓</span>
      <div><strong>Nachweis geprüft</strong></div>
    </div>{/if}
  <div class="stats">
    <article class="stat">
      <span>{report ? 'Istzeit laut Nachweis' : 'Eigene Arbeitszeit'}</span><strong
        >{statHours(report ? reported('actualHours') : result.actual)}<small>h</small></strong
      >
      <p>
        {report ? 'Übernommene Angabe des Betriebs' : `${hours(result.credited)} h zusätzlich für Urlaub / Krankheit`}
      </p>
    </article>
    <article class="stat">
      <span>{report ? 'Vertragliche Sollzeit' : 'Sollzeit laut Profil'}</span><strong
        >{statHours(report ? reported('contractualTarget') : result.target)}<small>h</small></strong
      >
      <p>
        {report
          ? `Dienstplan: ${value(reported('plannedTarget'))}`
          : 'Feiertage und Monatseinstellungen berücksichtigt'}
      </p>
    </article>
    <article class="stat">
      <span>{report ? 'Zeitkonto laut Nachweis' : 'Berechnetes Zeitkonto'}</span><strong
        >{statHours(report ? reported('closingBalance') : result.balance)}<small>h</small></strong
      >
      <p>
        {report
          ? `Vorheriger Stand: ${value(reported('openingBalance'))}`
          : 'Anfangsstand + Monatsdifferenz + Korrekturen'}
      </p>
    </article>
    <article class="stat highlight">
      <span>{report ? 'Zusatzvergütung' : 'Vorläufige Vergütung'}</span><strong class="money"
        >{report ? (combinedAuditPay == null ? 'Offen' : euro(combinedAuditPay)) : ownTotalPay}</strong
      >
      <p>
        {report
          ? paymentAcknowledged
            ? 'Alle Auszahlungen quittiert'
            : paymentCount
              ? 'Aus Nachweiswerten · Auszahlungen quittieren'
              : 'Vergütungsgrundlagen prüfen'
          : continuedLines.length
            ? 'Zuschläge, Dienstvergütung und Entgeltfortzahlung'
            : 'Zuschläge und erfasste Dienstvergütung'}
      </p>
    </article>
  </div>
  <div class="stats" aria-label="Weitere Monatsstatistiken">
    <article class="stat">
      <span>Monatssaldo</span><strong>{statHours(monthStats.delta)}<small>h</small></strong>
      <p>
        {reported('monthlyBalance') !== null
          ? 'Laut Nachweis'
          : report
            ? 'Istzeit − Vertragssoll'
            : 'Regeldienst + Abwesenheitsgutschrift − Sollzeit'}
      </p>
    </article>
    <article class="stat">
      <span>Bereitschaftsdienste</span><strong>{statCount(monthStats.standbyCount)}</strong>
      <p>{value(monthStats.standbyHours)} BD · Rufbereitschaften: {statCount(monthStats.oncallCount)}</p>
    </article>
    <article class="stat">
      <span>Nachtstunden</span><strong>{statHours(monthStats.night)}<small>h</small></strong>
      <p>Regeldienst und Bereitschaftsdienst</p>
    </article>
    <article class="stat">
      <span>Sonntagsstunden</span><strong>{statHours(monthStats.sunday)}<small>h</small></strong>
      <p>Samstagsstunden: {value(monthStats.saturday)}</p>
    </article>
    <article class="stat">
      <span>Feiertagsstunden</span><strong>{statHours(monthStats.holiday)}<small>h</small></strong>
      <p>{report ? 'Aus dem Nachweis' : 'Aus eigenen Arbeitszeiten'}</p>
    </article>
    <article class="stat">
      <span>Überstunden</span><strong>{statHours(monthStats.overtime)}<small>h</small></strong>
      <p>Ausgewiesene Zuschlagsstunden</p>
    </article>
    <article class="stat">
      <span>Urlaub</span><strong>{statCount(monthStats.vacationDays)}<small>Tage</small></strong>
      <p>Anrechenbare Urlaubstage</p>
    </article>
    <article class="stat">
      <span>Krankheit</span><strong>{statCount(monthStats.sickDays)}<small>Tage</small></strong>
      <p>Anrechenbare Krankheitstage</p>
    </article>
  </div>
  {#if employerIssues.length}<section class="panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">IM ORIGINAL GEMELDET</p>
          <h2>Zeitauswertungsfehler des Betriebs</h2>
        </div>
        <span class="badge warning">{employerIssues.length} Hinweise</span>
      </div>
      {#each employerIssues as issue}<div class="issue">
          <strong>{dateLabel(issue.date)}</strong><span>{issue.message}</span>
        </div>{/each}
    </section>{/if}
  <IssueInformation issues={informationalIssues} />
  {#if audit?.warnings.length || (!report && result.warnings.length)}<details class="panel">
      <summary
        >Hinweise <span class="badge neutral">{report ? audit?.warnings.length : result.warnings.length}</span></summary
      >
      <ul class="warnings">
        {#each report ? (audit?.warnings ?? []) : result.warnings as warning}<li>{warning}</li>{/each}
      </ul>
    </details>{/if}
{/if}
