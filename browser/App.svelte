<script lang="ts">
  import { onMount } from 'svelte';
  import Page from '../src/routes/+page.svelte';
  import { backup, getPage, restore, subscribe, refresh } from './store';
  import { restoreMessage } from '../src/lib/workspace';
  import type { WorkspaceData } from '../src/lib/workspace';
  let data = $state.raw<WorkspaceData | null>(null),
    error = $state(''),
    message = $state('');
  onMount(() => {
    getPage()
      .then(page => {
        data = page;
      })
      .catch(e => {
        error = e.message;
      });
    const unsubscribe = subscribe(page => {
      data = page;
    });
    const onPop = () => {
      refresh().catch(e => {
        error = e.message;
      });
    };
    const onLink = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest('a');
      if (anchor && new URL(anchor.href).pathname === '/api/export') {
        event.preventDefault();
        backup().catch(e => {
          error = e.message;
        });
      }
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('click', onLink, true);
    return () => {
      unsubscribe();
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('click', onLink, true);
    };
  });
  async function importBackup(event: Event) {
    error = '';
    message = '';
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('Sicherung zu groß (maximal 50 MB).');
      const result = await restore(await file.text());
      message = restoreMessage(result);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Sicherung konnte nicht gelesen werden.';
    }
    input.value = '';
  }
</script>

<div class="local-banner">
  <div>
    <strong>Lokale Browser-Version</strong><span
      >PDFs und Zeitdaten werden ausschließlich in diesem Browser verarbeitet und gespeichert. Browserdaten löschen
      entfernt auch diese Daten.</span
    >
  </div>
  <button
    onclick={() =>
      backup().catch(e => {
        error = e.message;
      })}>Sicherung exportieren</button
  ><label>Sicherung einlesen<input type="file" accept=".json,application/json" onchange={importBackup} /></label>
</div>
{#if error}<div class="notice danger" role="alert">{error}</div>{/if}
{#if message}<div class="notice good" role="status">{message}</div>{/if}
{#if data}<Page {data} localMode={true} />{:else if !error}<p class="local-loading">
    Lokale Daten werden geladen …
  </p>{/if}

<style>
  .local-banner {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 22px;
    background: #e4eddd;
    border-bottom: 1px solid #c7d8bc;
    font-size: 14px;
    position: relative;
    z-index: 2;
  }
  .local-banner > div {
    flex: 1;
  }
  .local-banner strong,
  .local-banner span {
    display: block;
  }
  .local-banner span {
    font-size: 12px;
    line-height: 1.5;
    margin-top: 4px;
  }
  .local-banner button,
  .local-banner label {
    font-size: 13px;
    background: white;
    padding: 9px 12px;
    border-radius: 6px;
    white-space: nowrap;
    border: 1px solid #c7d8bc;
    cursor: pointer;
  }
  .local-banner input {
    max-width: 180px;
    font-size: 12px;
    padding: 5px;
  }
  .local-loading {
    padding: 30px;
  }
  .notice {
    margin: 12px 22px;
  }
  .local-banner + :global(.shell .sidebar) {
    top: 100px;
  }
  @media (max-width: 800px) {
    .local-banner {
      flex-wrap: wrap;
    }
    .local-banner > div {
      flex-basis: 100%;
    }
    .local-banner input {
      max-width: 130px;
    }
  }
</style>
