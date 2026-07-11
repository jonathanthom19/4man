import { LEAGUE_MEMBERS } from '@/lib/league-members';
import { getPicksState } from '@/lib/picks-store';

const PHONE_ENV: Record<string, string> = { Charlie: 'PHONE_CHARLIE', Jon: 'PHONE_JON', Steven: 'PHONE_STEVEN', Avery: 'PHONE_AVERY' };
const sentMemory = new Set<string>();

async function wasSent(key: string): Promise<boolean> {
  if (!process.env.KV_REST_API_URL) return sentMemory.has(key);
  const { kv } = await import('@vercel/kv');
  return Boolean(await kv.get(key));
}
async function markSent(key: string): Promise<void> {
  if (!process.env.KV_REST_API_URL) { sentMemory.add(key); return; }
  const { kv } = await import('@vercel/kv');
  await kv.set(key, true, { ex: 60 * 60 * 48 });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return Response.json({ error: 'Twilio environment variables are not configured' }, { status: 503 });
  const state = await getPicksState();
  if (!state?.games.length) return Response.json({ sent: 0 });

  const now = Date.now();
  const upcoming = state.games.filter(g => {
    const until = new Date(g.commenceTime).getTime() - now;
    return until >= 55 * 60_000 && until <= 65 * 60_000;
  });
  if (!upcoming.length) return Response.json({ sent: 0 });

  // One text per member per kickoff window, even when several games start together.
  const windows = new Map<number, typeof upcoming>();
  for (const game of upcoming) {
    const window = Math.round(new Date(game.commenceTime).getTime() / (15 * 60_000));
    windows.set(window, [...(windows.get(window) ?? []), game]);
  }
  let sent = 0;
  for (const name of LEAGUE_MEMBERS) {
    const sub = state.submissions.find(s => s.userName === name);
    for (const [window, games] of windows) {
      const missing = games.filter(g => !sub?.picks.some(p => p.gameId === g.id));
      if (!missing.length) continue;
      const key = `picks_reminder:${state.season}:${state.weekNumber}:${name}:${window}`;
      if (await wasSent(key)) continue;
      const to = process.env[PHONE_ENV[name]];
      if (!to) continue;
      const params = new URLSearchParams({ To: to, From: from, Body: `4Man reminder: you are missing ${missing.length} pick${missing.length === 1 ? '' : 's'} for games starting in about one hour.` });
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST', headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
      if (response.ok) { await markSent(key); sent++; }
    }
  }
  return Response.json({ sent });
}
