// Central auth state for the server build. `hooks.server.ts` enforces the
// password; the page load reads `authEnabled` to show a warning banner when
// the app runs without authentication.
export const authEnabled = !!process.env.APP_PASSWORD;
