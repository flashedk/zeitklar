import type { SubmitFunction, ActionResult } from '@sveltejs/kit';
import { runAction } from '../src/lib/actions';
import { mutate, refresh } from './store';

/** Runs a form action against the browser's IndexedDB workspace. */
export function action(name: string, form: FormData): Promise<Record<string, unknown>> {
  return runAction(name, form, { mutate, extractPdf: async bytes => (await import('./pdf')).extractPdf(bytes) });
}

/** Same form contract as SvelteKit, with all actions fulfilled locally and no HTTP requests. */
export function enhance(form: HTMLFormElement, submit?: SubmitFunction) {
  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    const formData = new FormData(form, event.submitter as HTMLButtonElement | null);
    const url = new URL(form.action);
    let cancelled = false;
    const callback = await submit?.({
      action: url,
      formData,
      formElement: form,
      controller: new AbortController(),
      submitter: event.submitter as HTMLElement | null,
      cancel: () => {
        cancelled = true;
      }
    });
    if (cancelled) return;
    let result: ActionResult;
    try {
      result = { type: 'success', status: 200, data: await action(url.search.slice(2), formData) };
    } catch (error) {
      result = {
        type: 'failure',
        status: 400,
        data: { error: error instanceof Error ? error.message : 'Die Aktion konnte nicht abgeschlossen werden.' }
      };
    }
    const update = async (_options?: unknown) => {
      if (result.type === 'success') await refresh();
    };
    if (callback) await callback({ result, update, formData, formElement: form, action: url });
    else await update();
  };
  form.addEventListener('submit', onSubmit);
  return {
    destroy() {
      form.removeEventListener('submit', onSubmit);
    }
  };
}
