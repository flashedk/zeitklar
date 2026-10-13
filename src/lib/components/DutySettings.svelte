<script lang="ts">
  import {
    emptyDutyTemplate,
    dutyPhaseMinutes,
    isCompleteDutyTemplate,
    isEmptyDutyTemplate,
    type DutyTemplate
  } from '$lib/duty-templates';
  let { duties = $bindable<DutyTemplate[]>([]) }: { duties?: DutyTemplate[] } = $props();
  const newDuty = (): DutyTemplate => ({
    ...emptyDutyTemplate(),
    times: { start: '', regularEnd: '', standbyEnd: '', end: '' }
  });
  $effect(() => {
    if (!duties.length || isCompleteDutyTemplate(duties[duties.length - 1])) duties = [...duties, newDuty()];
  });
  function changeMode(duty: DutyTemplate, event: Event) {
    if ((event.target as HTMLSelectElement).value === 'times')
      duty.times = { start: '', regularEnd: '', standbyEnd: '', end: '' };
    else delete duty.times;
  }
  function updateTimes(duty: DutyTemplate) {
    try {
      const phases = dutyPhaseMinutes(duty);
      [duty.regularHours, duty.standbyHours, duty.secondRegularHours] = phases.map(minutes => minutes / 60);
    } catch {
      /* Incomplete clock fields remain editable until completed. */
    }
  }
  function changeTime(duty: DutyTemplate, key: 'start' | 'regularEnd' | 'standbyEnd' | 'end', event: Event) {
    duty.times![key] = (event.target as HTMLInputElement).value;
    updateTimes(duty);
  }
  const duration = (value: number) => (Number.isFinite(value) ? `${Math.round(value * 60)} min` : '—');
</script>

<section class="panel">
  <div class="panel-heading">
    <div>
      <p class="eyebrow">DIENSTERFASSUNG</p>
      <h2>Deine Dienste konfigurieren</h2>
    </div>
  </div>
  <p class="small-note">
    Lege die Zeitabschnitte deines Diensts fest. In der Tageserfassung wählst du danach nur Dienst, Start und Ende.
    Sobald eine Zeile vollständig ist, erscheint darunter eine neue. Änderungen werden automatisch gespeichert.
  </p>
  {#each duties as duty, i}
    <div class="duty-settings-row">
      <div class="duty-heading">
        <label
          >Dienstname<input
            type="text"
            maxlength="100"
            bind:value={duty.name}
            placeholder="z. B. N"
            aria-label={`Dienst ${i + 1}: Name`}
          /></label
        >
        <label
          >Zeiten festlegen<select
            value={duty.times ? 'times' : 'duration'}
            onchange={event => changeMode(duty, event)}
            aria-label={`Dienst ${i + 1}: Zeitangaben`}
            ><option value="times">Genaue Uhrzeiten</option><option value="duration">Dauer in Stunden</option></select
          ></label
        >
        <label
          >Bereitschaftsstufe<select bind:value={duty.bdLevel} aria-label={`Dienst ${i + 1}: Bereitschaftsstufe`}
            ><option value="I">Stufe I</option><option value="II">Stufe II</option></select
          ></label
        >
        <label
          >BD-Ausgleich<select
            value={duty.bdTimeOff === true ? 'fza' : 'paid'}
            onchange={event => (duty.bdTimeOff = (event.target as HTMLSelectElement).value === 'fza')}
            aria-label={`Dienst ${i + 1}: BD-Ausgleich`}
            ><option value="fza">Freizeitausgleich / Zeitkonto</option><option value="paid">Auszahlung</option></select
          ></label
        >
        <button
          type="button"
          class="icon-button duty-remove"
          aria-label={`Dienst ${i + 1} entfernen`}
          title="Dienst entfernen"
          disabled={isEmptyDutyTemplate(duty)}
          onclick={() => (duties = duties.filter((_, index) => index !== i))}>×</button
        >
      </div>
      <div class="duty-phases">
        {#if duty.times}
          <div>
            <strong>Regelarbeitszeit</strong>
            <div class="clock-pair">
              <label
                >Von<input
                  type="time"
                  value={duty.times.start}
                  oninput={event => changeTime(duty, 'start', event)}
                  aria-label={`Dienst ${i + 1}: Start Regelarbeitszeit`}
                /></label
              ><label
                >Bis<input
                  type="time"
                  value={duty.times.regularEnd}
                  oninput={event => changeTime(duty, 'regularEnd', event)}
                  aria-label={`Dienst ${i + 1}: Ende Regelarbeitszeit`}
                /></label
              >
            </div>
            <small>{duration(duty.regularHours)}</small>
          </div>
          <div>
            <strong>Bereitschaftszeit</strong>
            <div class="clock-pair">
              <label
                >Von<input
                  type="time"
                  value={duty.times.regularEnd}
                  readonly
                  aria-label={`Dienst ${i + 1}: Start Bereitschaftszeit`}
                /></label
              ><label
                >Bis<input
                  type="time"
                  value={duty.times.standbyEnd}
                  oninput={event => changeTime(duty, 'standbyEnd', event)}
                  aria-label={`Dienst ${i + 1}: Ende Bereitschaftszeit`}
                /></label
              >
            </div>
            <small>Optional · {duration(duty.standbyHours)}</small>
          </div>
          <div>
            <strong>Erneute Regelarbeitszeit</strong>
            <div class="clock-pair">
              <label
                >Von<input
                  type="time"
                  value={duty.times.standbyEnd || duty.times.regularEnd}
                  readonly
                  aria-label={`Dienst ${i + 1}: Start erneute Regelarbeitszeit`}
                /></label
              ><label
                >Bis<input
                  type="time"
                  value={duty.times.end}
                  oninput={event => changeTime(duty, 'end', event)}
                  aria-label={`Dienst ${i + 1}: Ende erneute Regelarbeitszeit`}
                /></label
              >
            </div>
            <small>Optional · {duration(duty.secondRegularHours)}</small>
          </div>
        {:else}
          <label
            >Regelarbeitszeit (h)<input
              type="number"
              min="0"
              max="24"
              step="0.01"
              bind:value={duty.regularHours}
              aria-label={`Dienst ${i + 1}: Regelarbeitszeit in Stunden`}
            /></label
          >
          <label
            >Bereitschaftszeit (h)<input
              type="number"
              min="0"
              max="24"
              step="0.01"
              bind:value={duty.standbyHours}
              aria-label={`Dienst ${i + 1}: Bereitschaftszeit in Stunden`}
            /></label
          >
          <label
            >Erneute Regelarbeitszeit (h)<input
              type="number"
              min="0"
              max="24"
              step="0.01"
              bind:value={duty.secondRegularHours}
              aria-label={`Dienst ${i + 1}: Erneute Regelarbeitszeit in Stunden`}
            /><small>Optional · 0, wenn sie entfällt</small></label
          >
        {/if}
      </div>
    </div>
  {/each}
  <p class="small-note">
    Ein Ende vor dem Beginn liegt am Folgetag. Beispiel N: 21:45–02:45 Regelarbeitszeit, 02:45–06:45 Bereitschaft Stufe
    II, 06:45–08:00 Regelarbeitszeit. Die Gesamtdauer darf bis zu 24 Stunden betragen.
  </p>
</section>

<style>
  .duty-settings-row {
    padding: 20px 0;
    border-top: 1px solid #e7eddd;
  }
  .duty-heading {
    display: grid;
    grid-template-columns: minmax(130px, 1.3fr) repeat(3, minmax(130px, 1fr)) 28px;
    gap: 16px;
    align-items: start;
  }
  .duty-phases {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
    margin-top: 20px;
  }
  .duty-phases strong {
    display: block;
    font-size: 13px;
    font-weight: 550;
    color: #627755;
    margin-bottom: 10px;
  }
  .clock-pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .duty-phases small {
    display: block;
    font-size: 12px;
    color: #87917f;
    margin-top: 8px;
  }
  .duty-settings-row input,
  .duty-settings-row select {
    width: 100%;
    box-sizing: border-box;
  }
  .duty-remove {
    margin-top: 28px;
    line-height: 1.5;
  }
  .duty-remove:disabled {
    opacity: 0.25;
    cursor: default;
  }
  @media (max-width: 1100px) {
    .duty-heading {
      grid-template-columns: repeat(2, minmax(0, 1fr)) 28px;
    }
    .duty-heading label:first-child {
      grid-column: 1/3;
    }
    .duty-remove {
      grid-column: 3;
      grid-row: 1;
    }
    .duty-phases {
      grid-template-columns: 1fr;
      gap: 18px;
    }
    .clock-pair {
      max-width: 400px;
    }
  }
  @media (max-width: 700px) {
    .duty-heading {
      grid-template-columns: repeat(2, minmax(0, 1fr)) 28px;
      gap: 13px 10px;
    }
    .duty-heading label:first-child {
      grid-column: 1/3;
    }
    .duty-remove {
      grid-column: 3;
      grid-row: 1;
      margin-top: 25px;
    }
    .duty-settings-row label {
      font-size: 13px;
    }
  }
</style>
