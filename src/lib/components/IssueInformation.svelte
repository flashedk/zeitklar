<script lang="ts">
  import { dateLabel } from '$lib/format';
  import type { TimeReport } from '$lib/report';

  let { issues }: { issues: TimeReport['issues'] } = $props();
</script>

{#if issues.length}
  <section class="panel" aria-label="Hinweise aus dem Nachweis">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">INFORMATION AUS DEM NACHWEIS</p>
        <h2>Hinweise aus dem Nachweis</h2>
      </div>
      <span class="badge neutral">Information</span>
    </div>
    {#each issues as issue}<div class="issue">
        <strong>{dateLabel(issue.date)}</strong><span>{issue.message}</span>
      </div>{/each}
    <p class="small-note">
      Meldungen der betrieblichen Zeitauswertung werden hier als Information angezeigt. Stunden und Vergütung werden in
      den Tabellen separat geprüft; diese Hinweise erfordern keine Quittierung.
    </p>
  </section>
{/if}
