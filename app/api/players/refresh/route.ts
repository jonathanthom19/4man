import { kvBustCache, fetchAndCache } from '@/app/api/players/route';

/**
 * Force-refresh the player cache: bust the existing entry then pull fresh
 * data from Sleeper and re-cache it.
 *
 * Called by the Vercel cron job daily at midnight UTC (see vercel.json).
 * Can also be triggered manually from the UI.
 */
export async function GET() {
  try {
    await kvBustCache();
    const { players, updatedAt } = await fetchAndCache();
    return Response.json({ players, updatedAt, refreshed: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
