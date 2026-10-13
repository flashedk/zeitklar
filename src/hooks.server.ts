import type { Handle } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { authEnabled } from '$lib/server/auth';
import { createFailureLimiter } from '$lib/server/rate-limit';

function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

if (!authEnabled) {
  console.warn(
    '[zeitklar] APP_PASSWORD ist nicht gesetzt. Die App ist ohne Anmeldung erreichbar. Für Zugriff außerhalb des lokalen Rechners unbedingt APP_PASSWORD setzen und einen HTTPS-Reverse-Proxy vorschalten.'
  );
}

// The client address comes from adapter-node: behind a reverse proxy, set ADDRESS_HEADER/XFF_DEPTH
// so it is taken from the proxy's header. Raw X-Forwarded-For is client-controlled and never trusted.
const limiter = createFailureLimiter();

export const handle: Handle = async ({ event, resolve }) => {
  const password = process.env.APP_PASSWORD;
  if (password) {
    const ip = event.getClientAddress();
    if (limiter.blocked(ip))
      return new Response('Zu viele Anmeldeversuche. Bitte später erneut versuchen.', {
        status: 429,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' }
      });
    const header = event.request.headers.get('authorization') || '';
    const credentials = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString() : '';
    if (!equal(credentials, `zeitklar:${password}`)) {
      // A browser's first request carries no credentials; only a wrong password counts as a failure.
      if (header) limiter.fail(ip);
      return new Response('Anmeldung erforderlich.', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Zeitklar", charset="UTF-8"', 'Cache-Control': 'no-store' }
      });
    }
    limiter.succeed(ip);
  }
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Cache-Control', 'no-store');
  if (!authEnabled) response.headers.set('X-Zeitklar-Auth-Warning', '1');
  return response;
};
