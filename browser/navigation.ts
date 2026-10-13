import { refresh } from './store';
export async function goto(url: string, _options?: unknown) {
  const target = new URL(url, window.location.href);
  if (target.origin !== window.location.origin)
    throw new Error('Navigation außerhalb dieser App ist nicht vorgesehen.');
  history.pushState({}, '', target);
  await refresh();
}
