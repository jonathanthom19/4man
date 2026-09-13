import type { PicksState } from './types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Line movement matters more near kickoff. One request refreshes every NFL game,
 * so this cadence is based on the next game that has not started.
 */
export function lineRefreshIntervalMs(state: PicksState, now = Date.now()): number | null {
  const nextKickoff = state.games
    // The league uses the first submitted pick to freeze a shared line. There
    // is no value spending credits refreshing a line that can no longer move.
    .filter(game => game.lineLockedAt == null && new Date(game.commenceTime).getTime() > now)
    .reduce<number | null>((next, game) => {
      const kickoff = new Date(game.commenceTime).getTime();
      return next == null || kickoff < next ? kickoff : next;
    }, null);

  if (nextKickoff == null) return null;
  const untilKickoff = nextKickoff - now;
  if (untilKickoff <= 6 * HOUR) return HOUR;
  if (untilKickoff <= 24 * HOUR) return 3 * HOUR;
  if (untilKickoff <= 72 * HOUR) return 12 * HOUR;
  return 24 * HOUR;
}

export function shouldRefreshLines(state: PicksState, now = Date.now()): boolean {
  const interval = lineRefreshIntervalMs(state, now);
  if (interval == null) return false;
  const lastAttempt = state.gamesRefreshAttemptedAt ?? state.gamesRefreshedAt ?? 0;
  return now - lastAttempt >= interval;
}

/**
 * The score endpoint only supplies completed games. Avoid spending credits while
 * games are young, then check closely around normal completion. Back off for a
 * delayed final instead of polling it all night.
 */
export function scoreRefreshIntervalMs(state: PicksState, now = Date.now()): number | null {
  const started = state.games.filter(game =>
    !game.completed && new Date(game.commenceTime).getTime() <= now,
  );
  if (!started.length) return null;

  const oldestAge = Math.max(...started.map(game => now - new Date(game.commenceTime).getTime()));
  if (oldestAge < 3 * HOUR) return null;
  if (oldestAge < 6 * HOUR) return 15 * MINUTE;
  if (oldestAge < 12 * HOUR) return HOUR;
  return 6 * HOUR;
}

export function shouldRefreshScores(state: PicksState, now = Date.now()): boolean {
  const interval = scoreRefreshIntervalMs(state, now);
  if (interval == null) return false;
  const lastAttempt = state.scoresRefreshAttemptedAt ?? state.scoresRefreshedAt ?? 0;
  return now - lastAttempt >= interval;
}
