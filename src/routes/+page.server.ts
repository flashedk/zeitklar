import { fail, type Action } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { actionNames, runAction } from '$lib/actions';
import { buildPage } from '$lib/workspace';
import { mutate, readSnapshot } from '$lib/server/db';
import { extractPdf } from '$lib/server/pdf';
import { authEnabled } from '$lib/server/auth';

export const load: PageServerLoad = ({ url }) => ({ ...buildPage(readSnapshot(), url), authWarning: !authEnabled });

const toAction =
  (name: string): Action =>
  async ({ request }) => {
    try {
      return await runAction(name, await request.formData(), { mutate, extractPdf });
    } catch (error) {
      return fail(400, {
        error: error instanceof Error ? error.message : 'Die Aktion konnte nicht abgeschlossen werden.'
      });
    }
  };

export const actions: Actions = Object.fromEntries(actionNames.map(name => [name, toAction(name)]));
