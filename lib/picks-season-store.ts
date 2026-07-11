import type { LockRecord, PicksSeasonState } from './types';
import { LEAGUE_MEMBERS } from './league-members';

const SEASON_KEY = 'fantasy_picks_season';

let memSeason: PicksSeasonState | null = null;

function hasKv(): boolean {
  return Boolean(process.env.KV_REST_API_URL);
}

function defaultSeason(season: string): PicksSeasonState {
  return {
    season,
    balances: Object.fromEntries(LEAGUE_MEMBERS.map(m => [m, 0])),
    lockRecords: Object.fromEntries(
      LEAGUE_MEMBERS.map(m => [m, { wins: 0, losses: 0, pushes: 0 } satisfies LockRecord]),
    ),
  };
}

export async function getPicksSeason(season: string): Promise<PicksSeasonState> {
  if (hasKv()) {
    const { kv } = await import('@vercel/kv');
    const all = (await kv.get<Record<string, PicksSeasonState>>(SEASON_KEY)) ?? {};
    return all[season] ?? defaultSeason(season);
  }
  if (memSeason?.season === season) return memSeason;
  return defaultSeason(season);
}

export async function setPicksSeason(state: PicksSeasonState): Promise<void> {
  if (hasKv()) {
    const { kv } = await import('@vercel/kv');
    const all = (await kv.get<Record<string, PicksSeasonState>>(SEASON_KEY)) ?? {};
    all[state.season] = state;
    await kv.set(SEASON_KEY, all);
    return;
  }
  memSeason = state;
}

export async function applyWeeklySeasonUpdate(
  season: string,
  poolDeltas: Record<string, number>,
  lockResults: Record<string, import('./types').PickResult>,
): Promise<PicksSeasonState> {
  const current = await getPicksSeason(season);
  const balances = { ...current.balances };
  for (const [user, delta] of Object.entries(poolDeltas)) {
    balances[user] = (balances[user] ?? 0) + delta;
  }

  const lockRecords = { ...current.lockRecords };
  for (const [user, result] of Object.entries(lockResults)) {
    const cur = lockRecords[user] ?? { wins: 0, losses: 0, pushes: 0 };
    if (result === 'win') lockRecords[user] = { ...cur, wins: cur.wins + 1 };
    else if (result === 'loss') lockRecords[user] = { ...cur, losses: cur.losses + 1 };
    else if (result === 'push') lockRecords[user] = { ...cur, pushes: cur.pushes + 1 };
  }

  const next: PicksSeasonState = { season, balances, lockRecords };
  await setPicksSeason(next);
  return next;
}
