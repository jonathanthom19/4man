/**
 * Seeds fake NFL game data for testing — only callable in development
 * or explicitly by an admin when no real games are available.
 */

import { getPicksState, setPicksState } from '@/lib/picks-store';
import { computeLockTime } from '@/lib/picks-utils';
import type { NFLGame, PicksState } from '@/lib/types';

const SEED_GAMES: Omit<NFLGame, 'id' | 'lockTime'>[] = [
  {
    homeTeam:     'Philadelphia Eagles',
    awayTeam:     'Dallas Cowboys',
    commenceTime: nextThursday().toISOString(),
    homeSpread:   -8.5,
  },
  {
    homeTeam:     'Kansas City Chiefs',
    awayTeam:     'Los Angeles Chargers',
    commenceTime: nextSunday(13).toISOString(),
    homeSpread:   -6.5,
  },
  {
    homeTeam:     'Atlanta Falcons',
    awayTeam:     'Tampa Bay Buccaneers',
    commenceTime: nextSunday(13).toISOString(),
    homeSpread:   2.5,
  },
  {
    homeTeam:     'Cleveland Browns',
    awayTeam:     'Cincinnati Bengals',
    commenceTime: nextSunday(13).toISOString(),
    homeSpread:   -3,
  },
  {
    homeTeam:     'San Francisco 49ers',
    awayTeam:     'Seattle Seahawks',
    commenceTime: nextSunday(16, 25).toISOString(),
    homeSpread:   -5.5,
  },
];

function nextThursday(): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7));
  d.setHours(20, 15, 0, 0);
  return d;
}

function nextSunday(hours: number, minutes = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((0 - d.getDay() + 7) % 7 || 7));
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function weekLabel(games: NFLGame[]): string {
  const times = games.map(g => new Date(g.commenceTime).getTime());
  const min   = new Date(Math.min(...times));
  const max   = new Date(Math.max(...times));
  const fmt   = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  const year  = min.getFullYear();
  return min.getMonth() === max.getMonth()
    ? `${fmt(min)}–${max.getDate()}, ${year}`
    : `${fmt(min)} – ${fmt(max)}, ${year}`;
}

export async function POST() {
  try {
    const games: NFLGame[] = SEED_GAMES.map((g, i) => ({
      ...g,
      id:       `test-game-${i + 1}`,
      lockTime: computeLockTime(g.commenceTime),
    }));

    const current = await getPicksState();
    const next: PicksState = {
      weekLabel:        weekLabel(games) + ' (TEST)',
      games,
      gamesRefreshedAt: Date.now(),
      submissions:      current?.submissions ?? [],
    };

    await setPicksState(next);
    return Response.json({ state: next });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
