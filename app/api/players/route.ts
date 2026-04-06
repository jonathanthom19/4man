import type { Player } from '@/lib/types';

// ─────────────────────────────────────────────────────────────────────────────
// KV helpers — gracefully no-ops when credentials aren't present (local dev)
// ─────────────────────────────────────────────────────────────────────────────

function hasKv(): boolean {
  return Boolean(process.env.KV_REST_API_URL);
}

async function kvGetCache(): Promise<{ players: Player[]; updatedAt: number } | null> {
  if (!hasKv()) return null;
  try {
    const { kv } = await import('@vercel/kv');
    return kv.get<{ players: Player[]; updatedAt: number }>(CACHE_KEY);
  } catch {
    return null;
  }
}

async function kvSetCache(data: { players: Player[]; updatedAt: number }): Promise<void> {
  if (!hasKv()) return;
  try {
    const { kv } = await import('@vercel/kv');
    await kv.set(CACHE_KEY, data, { ex: CACHE_TTL });
  } catch { /* best-effort */ }
}

export async function kvBustCache(): Promise<void> {
  if (!hasKv()) return;
  try {
    const { kv } = await import('@vercel/kv');
    await kv.del(CACHE_KEY);
  } catch { /* best-effort */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SLEEPER_URL = 'https://api.sleeper.app/v1/players/nfl';
const CACHE_KEY   = 'sleeper_players_v2';
const CACHE_TTL   = 60 * 60 * 25; // 25 h — slightly longer than daily cron cadence

// ─────────────────────────────────────────────────────────────────────────────
// Core logic — exported so the /refresh route can reuse it
// ─────────────────────────────────────────────────────────────────────────────

function processPlayers(raw: Record<string, Record<string, unknown>>): Player[] {
  const validPos = new Set(['QB', 'RB', 'WR', 'TE']);
  const players: Player[] = [];

  for (const [id, p] of Object.entries(raw)) {
    if (!p.team) continue;
    const status = p.status as string | null;
    if (status === 'Inactive' || status === 'Suspended') continue;
    const pos = (p.fantasy_positions as string[])?.[0] ?? (p.position as string);
    if (!validPos.has(pos)) continue;
    const rank = p.search_rank as number;
    if (!rank || rank > 600) continue;
    const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
    if (!name) continue;

    players.push({
      player_id: id,
      name,
      pos: pos as Player['pos'],
      team:   p.team as string,
      rank,
      bye:    (p.bye_week      as number) ?? null,
      status: (p.injury_status as string) ?? null,
      age:    (p.age           as number) ?? null,
    });
  }

  return players.sort((a, b) => a.rank - b.rank);
}

/** Fetch fresh data from Sleeper, cache it, and return it with a timestamp. */
export async function fetchAndCache(): Promise<{ players: Player[]; updatedAt: number }> {
  const res = await fetch(SLEEPER_URL);
  if (!res.ok) throw new Error(`Sleeper returned ${res.status}`);
  const raw = await res.json() as Record<string, Record<string, unknown>>;

  const players   = processPlayers(raw);
  const updatedAt = Date.now();

  await kvSetCache({ players, updatedAt });
  return { players, updatedAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const cached = await kvGetCache();
    if (cached) {
      return Response.json({ players: cached.players, updatedAt: cached.updatedAt, cached: true });
    }

    const { players, updatedAt } = await fetchAndCache();
    return Response.json({ players, updatedAt, cached: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}

/** Manual or cron-triggered cache bust — use DELETE or hit /api/players/refresh */
export async function DELETE() {
  await kvBustCache();
  return Response.json({ ok: true });
}
