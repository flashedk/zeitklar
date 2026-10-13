import { exportData } from '$lib/server/db';
export const GET = () =>
  new Response(JSON.stringify(exportData(), null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="zeitklar-export.json"',
      'Cache-Control': 'no-store'
    }
  });
