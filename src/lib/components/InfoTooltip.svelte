<script lang="ts">
  let { text, label = 'Information' }: { text: string; label?: string } = $props();
  const id = $props.id();
  let button: HTMLButtonElement;
  let tooltip: HTMLDivElement;
  let open = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  function hide() {
    clearTimeout(hideTimer);
    if (tooltip?.matches(':popover-open')) tooltip.hidePopover();
    open = false;
  }
  function show() {
    clearTimeout(hideTimer);
    if (!button || !tooltip) return;
    const rect = button.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    tooltip.style.maxWidth = `${Math.min(420, viewportWidth - 16)}px`;
    if (!tooltip.matches(':popover-open')) tooltip.showPopover();
    const width = tooltip.offsetWidth,
      height = tooltip.offsetHeight;
    tooltip.style.left = `${Math.max(8, Math.min(rect.left, viewportWidth - width - 8))}px`;
    tooltip.style.top = `${Math.max(8, rect.bottom + height + 8 <= viewportHeight ? rect.bottom + 8 : rect.top - height - 8)}px`;
    open = true;
  }
  function hideSoon() {
    hideTimer = setTimeout(hide, 120);
  }
</script>

<svelte:window onresize={hide} onscroll={hide} />
<button
  bind:this={button}
  type="button"
  class="info-icon"
  aria-label={label}
  aria-describedby={id}
  aria-expanded={open}
  onmouseenter={show}
  onmouseleave={hideSoon}
  onfocus={show}
  onblur={hide}
  onclick={show}
  onkeydown={event => {
    if (event.key === 'Escape') hide();
  }}><span aria-hidden="true">i</span></button
>
<div
  bind:this={tooltip}
  {id}
  popover="manual"
  role="tooltip"
  class="info-popover"
  onmouseenter={() => clearTimeout(hideTimer)}
  onmouseleave={hideSoon}
>
  {text}
</div>

<style>
  .info-icon {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    border: 1px solid #9eac99;
    border-radius: 50%;
    font:
      600 11px Georgia,
      serif;
    color: #607858;
    background: #f7faf2;
    padding: 0;
    cursor: help;
    vertical-align: middle;
  }
  .info-icon:hover,
  .info-icon:focus-visible {
    background: #e7efdf;
    border-color: #607858;
  }
  .info-popover {
    position: fixed;
    inset: auto;
    margin: 0;
    width: max-content;
    max-width: min(420px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow: auto;
    border: 1px solid #ccd9c1;
    border-radius: 8px;
    background: #fff;
    color: #435c3c;
    padding: 13px 16px;
    font:
      400 12px/1.65 system-ui,
      sans-serif;
    box-shadow: 0 6px 24px #233d3526;
    white-space: pre-line;
  }
</style>
