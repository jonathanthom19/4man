import type { ArchivedPicksWeek, LockRecord, PicksSeasonState } from './types';
import { LEAGUE_MEMBERS } from './league-members';
import { computeLockResults } from './picks-grading';

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

/** Rebuild a season deterministically from its archive, making archive retries safe. */
export function rebuildSeasonFromArchive(
  season: string,
  weeks: ArchivedPicksWeek[],
): { seasonState: PicksSeasonState; weeks: ArchivedPicksWeek[] } {
  const balances: Record<string, number> = Object.fromEntries(LEAGUE_MEMBERS.map(m => [m, 0]));
  const lockRecords: Record<string, LockRecord> = Object.fromEntries(
    LEAGUE_MEMBERS.map(m => [m, { wins: 0, losses: 0, pushes: 0 }]),
  );

  const rebuilt = [...weeks]
    .sort((a, b) => a.archivedAt - b.archivedAt)
    .map(week => {
      for (const [name, delta] of Object.entries(week.weeklyPoolDeltas)) {
        balances[name] = (balances[name] ?? 0) + delta;
      }
      for (const [name, result] of Object.entries(computeLockResults(week.games, week.submissions))) {
        const record = lockRecords[name] ?? { wins: 0, losses: 0, pushes: 0 };
        if (result === 'win') record.wins++;
        else if (result === 'loss') record.losses++;
        else if (result === 'push') record.pushes++;
        lockRecords[name] = record;
      }
      return {
        ...week,
        balancesAfterWeek: { ...balances },
        lockRecordsAfterWeek: structuredClone(lockRecords),
      };
    });

  return {
    seasonState: { season, balances: { ...balances }, lockRecords: structuredClone(lockRecords) },
    weeks: rebuilt,
  };
}
