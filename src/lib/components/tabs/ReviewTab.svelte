<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { euro } from '$lib/calculate';
  import { acknowledgmentLabel, dateLabel, monthLabel, value } from '$lib/format';
  import { presentEmployerCheck } from '$lib/check-presentation';
  import { presentPayLine } from '$lib/pay-presentation';
  import { personalCheckLabel } from '$lib/personal-check-label';
  import { tariffProfile } from '$lib/tariff';
  import type { Settlement } from '$lib/model';
  import type { ReviewCheck } from '$lib/review';
  import type { MonthView } from '$lib/month-view';
  import { monthHasPending as hasPending, type WorkspaceData } from '$lib/workspace';
  import InfoTooltip from '../InfoTooltip.svelte';
  import IssueInformation from '../IssueInformation.svelte';

  let {
    data,
    view,
    busy,
    submit,
    openTab,
    openReviewMonth,
    settlement = $bindable()
  }: {
    data: WorkspaceData;
    view: MonthView;
    busy: boolean;
    submit: SubmitFunction;
    openTab: (tab: string) => void;
    openReviewMonth: (month: string) => void;
    settlement: Settlement;
  } = $props();
  const {
    report,
    result,
    ownPay,
    audit,
    sickness,
    continuedLines,
    continuedAmount,
    ownTotalPay,
    combinedAuditPay,
    informationalIssues,
    review,
    employerChecks,
    employerCheckRows,
    paymentChecks,
    personalChecks,
    flags
  } = $derived(view);
  const reviewMonths = $derived(data.reviewMonths);
  const savedTariff = $derived(tariffProfile(data.rules, data.month));
  const monthHasPending = (month: string) => hasPending(data, month);
  let bdDetailsOpen = $state<Record<string, boolean>>({});
</script>

{#snippet checkStatus(check: ReviewCheck)}
  {#if check.status === 'review' && review && check.key}
    <form class="review-check-action" action="?/acknowledge" method="POST" use:enhance={submit}>
      <input type="hidden" name="reportKey" value={review.reportKey} /><input
        type="hidden"
        name="checkKey"
        value={check.key}
      /><input type="hidden" name="acknowledged" value={check.acknowledgedAt ? 'false' : 'true'} />
      <button
        class="status review review-button"
        class:acknowledged={!!check.acknowledgedAt}
        disabled={busy}
        aria-label={`${check.acknowledgedAt ? 'Quittierung aufheben' : check.title.startsWith('Auszahlung: ') ? 'Auszahlung quittieren' : 'Prüfpunkt quittieren'}: ${check.title}`}
        title={check.acknowledgedAt
          ? `Quittierung aufheben · quittiert am ${acknowledgmentLabel(check.acknowledgedAt)}`
          : 'Manuell geprüft: Klicken, um diesen Prüfpunkt zu quittieren'}
        >{check.title.startsWith('Auszahlung: ')
          ? check.acknowledgedAt
            ? 'Auszahlung quittiert ✓'
            : 'Auszahlung quittieren'
          : check.acknowledgedAt
            ? 'Quittiert ✓'
            : 'Prüfen'}</button
      >
    </form>
  {:else}<span class={`status ${check.status}`}
      >{check.status === 'ok' ? 'Stimmig' : check.status === 'difference' ? 'Abweichung' : 'Prüfen'}</span
    >{/if}
{/snippet}
{#snippet checkExplanation(check: ReviewCheck)}
  {@const view = presentEmployerCheck(check, audit?.hoursSummary ?? null, report)}
  {#if view.formula}<p class="check-formula">{view.formula}</p>{/if}
  {#if view.facts.length}<ul class="check-facts">
      {#each view.facts as fact}<li>{fact}</li>{/each}
    </ul>{/if}
{/snippet}

{#if reviewMonths.length}<div class="review-months">
    <span>Monate mit offenen Prüfpunkten</span>
    <div>
      {#each reviewMonths as reviewMonth}<button
          class:current={reviewMonth === data.month}
          onclick={() => openReviewMonth(reviewMonth)}
          aria-label={`${monthLabel(reviewMonth)}: ${monthHasPending(reviewMonth) ? 'Upload bestätigen' : 'offene Prüfpunkte ansehen'}`}
          >{monthLabel(reviewMonth)}{#if monthHasPending(reviewMonth)}<small>Upload bestätigen</small>{/if}</button
        >{/each}
    </div>
  </div>{/if}
{#if report && flags === 0 && employerChecks.length}<div class="review-complete">
    <span class="check-icon ok" aria-hidden="true">✓</span>
    <div><strong>Nachweis geprüft</strong></div>
  </div>{/if}
{#if personalChecks.length}<section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">EIGENE ZEITEN GEGEN BETRIEB</p>
        <h2>Tagesaufzeichnung vergleichen</h2>
      </div>
      <span class="badge neutral">{personalChecks.length} Tage</span>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Tag</th><th>Eigene Zeit</th><th>Betrieb</th><th>Status</th></tr></thead><tbody
          >{#each personalChecks as check}<tr
              ><td><strong>{personalCheckLabel(check, data.entries, report)}</strong></td><td
                >{value(check.expected, check.unit)}</td
              ><td>{value(check.reported, check.unit)}</td><td>{@render checkStatus(check)}</td></tr
            >{/each}</tbody
        >
      </table>
    </div>
  </section>{/if}
{#if employerChecks.length}
  <section class="panel">
    <div class="panel-heading">
      <h2>Prüfung des Dienstmonats</h2>
      <span class="badge neutral">{flags} {flags === 1 ? 'Prüfpunkt offen' : 'Prüfpunkte offen'}</span>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Prüfung</th><th>Berechnet</th><th>Laut Nachweis</th><th>Status</th></tr></thead>
        <tbody
          >{#each employerCheckRows as row}
            {@const check = row.check}
            {@const view = presentEmployerCheck(check, audit?.hoursSummary ?? null, report)}
            <tr class:bd-summary={!!row.children}
              ><td>
                <div class="check-title">
                  {#if row.children}<button
                      type="button"
                      class="bd-details-toggle"
                      aria-expanded={!!bdDetailsOpen[check.title]}
                      onclick={() => (bdDetailsOpen[check.title] = !bdDetailsOpen[check.title])}
                      ><span aria-hidden="true">{bdDetailsOpen[check.title] ? '▾' : '▸'}</span><strong
                        >{view.title}</strong
                      ><span class="bd-detail-count"
                        >{row.children.length} {row.children.length === 1 ? 'Tag' : 'Tage'}</span
                      ></button
                    >{:else}<strong>{view.title}</strong>{/if}
                  {#if view.info}<InfoTooltip text={view.info} label={`Information zu ${view.title}`} />{/if}
                </div>
                {@render checkExplanation(check)}
              </td><td>{value(check.expected, check.unit)}</td><td>{value(check.reported, check.unit)}</td><td
                >{#if row.children && check.acknowledgedAt && check.status === 'review'}<span
                    class="status review acknowledged">Quittiert ✓</span
                  >{:else}{@render checkStatus(check)}{/if}</td
              ></tr
            >
            {#if row.children && bdDetailsOpen[check.title]}{#each row.children as child}
                {@const childView = presentEmployerCheck(child, audit?.hoursSummary ?? null, report)}
                <tr class="bd-detail-row"
                  ><td
                    ><div class="check-title">
                      <strong>{childView.title}</strong>{#if childView.info}<InfoTooltip
                          text={childView.info}
                          label={`Information zu ${childView.title}`}
                        />{/if}
                    </div>
                    {@render checkExplanation(child)}</td
                  ><td>{value(child.expected, child.unit)}</td><td>{value(child.reported, child.unit)}</td><td
                    >{@render checkStatus(child)}</td
                  ></tr
                >
              {/each}{/if}
          {/each}</tbody
        >
      </table>
    </div>
  </section>
{/if}{#if audit || sickness}
  <section class="panel">
    <div class="panel-heading">
      <div>
        {#if !report}<p class="eyebrow">VORLÄUFIG</p>{/if}
        <h2>Vergütung</h2>
      </div>
      <strong class="pay-total">{combinedAuditPay == null ? 'Grundlagen fehlen' : euro(combinedAuditPay)}</strong>
    </div>
    <p class="small-note">
      Zuschläge und Entgeltfortzahlung werden zur Gesamtvergütung addiert. Vergleiche die Positionen mit der
      Lohnabrechnung für diesen Dienstmonat.
    </p>
    {#if audit && !savedTariff.individualRate}<div class="notice warning">
        Dein individuelles Stundenentgelt fehlt. <button class="text-link" onclick={() => openTab('Einstellungen')}
          >In den Einstellungen ergänzen →</button
        >
      </div>{/if}
    <div class="table-scroll">
      <table>
        <thead><tr><th>Position</th><th>Stunden</th><th>Satz</th><th>Betrag</th><th>Auszahlung</th></tr></thead><tbody>
          {#each audit?.payLines ?? [] as line}{@const view = presentPayLine(line)}<tr
              ><td
                ><strong>{line.label}</strong>{#if view.basis}<small class="check-detail">{view.basis}</small>{/if}</td
              ><td>{view.quantity}</td><td>{euro(line.rate)}</td><td>{euro(line.amount)}</td><td
                >{#each paymentChecks.filter(check => check.title === `Auszahlung: ${line.label}`) as check}{@render checkStatus(
                    check
                  )}{/each}</td
              ></tr
            >{/each}
          {#each continuedLines as line}<tr
              ><td
                ><strong
                  >Entgeltfortzahlung {line.kind === 'vacation' ? 'Urlaub' : 'Krankheit'}{continuedLines.filter(
                    l => l.kind === line.kind
                  ).length > 1
                    ? ` ab ${dateLabel(line.start)}`
                    : ''}</strong
                ><small class="check-detail">{line.detail}</small></td
              ><td>{line.count} {line.count === 1 ? 'Tag' : 'Tage'}</td><td
                >{line.dailyRate === null ? 'Grundlagen fehlen' : `${euro(line.dailyRate)} / Tag`}</td
              ><td>{line.amount === null ? 'Grundlagen fehlen' : euro(line.amount)}</td><td
                >{#each paymentChecks.filter(check => check.basisKey === line.basisKey) as check}{@render checkStatus(
                    check
                  )}{/each}</td
              ></tr
            >{/each}
        </tbody>
      </table>
    </div>
    {#if audit?.warnings.length}<details open>
        <summary>Berechnungsgrundlagen prüfen</summary>
        <ul class="warnings">
          {#each audit.warnings as warning}<li>{warning}</li>{/each}
        </ul>
      </details>{/if}
  </section>{/if}

<section class="panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">MONATSNOTIZ · {monthLabel(data.month)}</p>
      <h2>Notiz zum Abgleich</h2>
    </div>
  </div>
  <form action="?/month-settings" method="POST" use:enhance={submit}>
    <input type="hidden" name="month" value={data.month} /><label
      >Notiz<textarea
        name="note"
        rows="2"
        bind:value={settlement.note}
        maxlength="2000"
        placeholder="Hinweise zu diesem Dienstmonat …"
      ></textarea></label
    ><button class="primary" disabled={busy}>Notiz speichern</button>
  </form>
</section>
{#if result.rows.length}<section class="panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">{report ? 'UNABHÄNGIGE BERECHNUNG' : 'VORLÄUFIG'}</p>
        <h2>Auf Basis eigener Einträge</h2>
      </div>
    </div>
    <div class="metric-list">
      <div><span>Zeitkonto-Anfangsstand</span><strong>{value(data.settlement.openingHours)}</strong></div>
      <div>
        <span>Regeldienst + anrechenbare Abwesenheiten</span><strong>{value(result.regular + result.credited)}</strong>
      </div>
      <div>
        <span>BD-Freizeitausgleich · Zeitgutschrift</span><strong>{value(result.standbyCredit)}</strong>
      </div>
      <div><span>BD zur Auszahlung · bewertet</span><strong>{value(result.standbyPaidHours)}</strong></div>
      <div><span>Sollzeit</span><strong>{value(result.target)}</strong></div>
      <div><span>Monatsdifferenz</span><strong>{value(result.delta)}</strong></div>
      <div><span>Zeitkonto</span><strong>{value(result.balance)}</strong></div>
      <div><span>Zuschläge</span><strong>{ownPay(result.expectedBonus)}</strong></div>
      <div><span>Dienst- und weitere Vergütung</span><strong>{ownPay(result.dutyPay)}</strong></div>
      {#if continuedLines.length}<div>
          <span>Entgeltfortzahlung – variable Bestandteile</span><strong
            >{continuedAmount === null ? 'Grundlagen fehlen' : euro(continuedAmount)}</strong
          >
        </div>{/if}
      <div><span>Zusatzvergütung gesamt</span><strong>{ownTotalPay}</strong></div>
      {#if result.hoursDifference != null}<div>
          <span>Stundendifferenz zur Abrechnung</span><strong>{value(result.hoursDifference)}</strong>
        </div>{/if}{#if result.balanceDifference != null}<div>
          <span>Kontodifferenz zur Abrechnung</span><strong>{value(result.balanceDifference)}</strong>
        </div>{/if}{#if result.bonusDifference != null}<div>
          <span>Vergütung minus Auszahlung</span><strong
            >{continuedAmount === null ? 'Grundlagen fehlen' : ownPay(result.bonusDifference + continuedAmount)}</strong
          >
        </div>{/if}
    </div>
    <p class="small-note">
      Bereitschaftsdienste mit Freizeitausgleich erhöhen das Zeitkonto um ihre bewerteten Stunden. Zur Auszahlung
      zugeordnete BD-Stunden fließen in die Vergütung ein.
    </p>
    <details>
      <summary>Berechnungshinweise</summary>
      <ul class="warnings">
        {#each result.warnings as warning}<li>{warning}</li>{/each}
      </ul>
    </details>
  </section>{/if}
<IssueInformation issues={informationalIssues} />
