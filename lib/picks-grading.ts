import type { LockRecord, NFLGame, PickResult, UserPicksSubmission } from './types';
import { LEAGUE_MEMBERS } from './league-members';

export type AtsCover = 'home' | 'away' | 'push';

/** Who covered the spread (null if scores/spread missing). */
export function computeAtsCover(game: NFLGame): AtsCover | null {
  const { homeScore, awayScore, homeSpread } = game;
  if (homeScore == null || awayScore == null || homeSpread == null) return null;

  const homeAdj = homeScore + homeSpread;
  if (homeAdj > awayScore) return 'home';
  if (homeAdj < awayScore) return 'away';
  return 'push';
}

export function teamCovered(teamName: string, game: NFLGame): boolean | null {
  const cover = computeAtsCover(game);
  if (!cover) return null;
  if (cover === 'push') return null;
  if (cover === 'home') return teamName === game.homeTeam;
  return teamName === game.awayTeam;
}

export function gradePick(selectedTeam: string, game: NFLGame): PickResult {
  if (!game.completed) return 'pending';
  const covered = teamCovered(selectedTeam, game);
  if (covered === null) return 'push';
  return covered ? 'win' : 'loss';
}

/** Per-game pool deltas among 4 players (zero-sum). */
export function poolDeltasForGame(
  game: NFLGame,
  picksByUser: Record<string, string | undefined>,
): Record<string, number> {
  if (!game.completed) return {};

  const entries = LEAGUE_MEMBERS.map(user => {
    const team = picksByUser[user];
    if (!team) return { user, result: 'missing' as const };
    const covered = teamCovered(team, game);
    if (covered === null) return { user, result: 'push' as const };
    return { user, result: covered ? ('win' as const) : ('loss' as const) };
  });

  const active = entries.filter(e => e.result !== 'missing');
  if (active.length === 0) return {};

  if (active.every(e => e.result === 'push')) {
    return Object.fromEntries(active.map(e => [e.user, 0]));
  }

  const winners = active.filter(e => e.result === 'win');
  const losers  = active.filter(e => e.result === 'loss');
  const w = winners.length;
  const l = losers.length;

  if (w === 4 || l === 4 || w === 0) {
    return Object.fromEntries(active.map(e => [e.user, 0]));
  }
  if (w === 1 && l === 3) {
    return Object.fromEntries(active.map(e => [e.user, e.result === 'win' ? 90 : -30]));
  }
  if (w === 3 && l === 1) {
    return Object.fromEntries(active.map(e => [e.user, e.result === 'win' ? 30 : -90]));
  }
  if (w === 2 && l === 2) {
    return Object.fromEntries(active.map(e => [e.user, e.result === 'win' ? 30 : -30]));
  }

  return Object.fromEntries(active.map(e => [e.user, 0]));
}

export function aggregatePoolDeltas(
  games: NFLGame[],
  submissions: UserPicksSubmission[],
): Record<string, number> {
  const totals: Record<string, number> = Object.fromEntries(LEAGUE_MEMBERS.map(m => [m, 0]));

  for (const game of games) {
    const picksByUser: Record<string, string | undefined> = {};
    for (const sub of submissions) {
      const pick = sub.picks.find(p => p.gameId === game.id);
      picksByUser[sub.userName] = pick?.selectedTeam;
    }
    const deltas = poolDeltasForGame(game, picksByUser);
    for (const [user, delta] of Object.entries(deltas)) {
      totals[user] = (totals[user] ?? 0) + delta;
    }
  }

  return totals;
}

export function computeLockResults(
  games: NFLGame[],
  submissions: UserPicksSubmission[],
): Record<string, PickResult> {
  const results: Record<string, PickResult> = {};
  for (const sub of submissions) {
    if (!sub.lockOfWeekGameId) continue;
    const game = games.find(g => g.id === sub.lockOfWeekGameId);
    const pick = sub.picks.find(p => p.gameId === sub.lockOfWeekGameId);
    if (!game || !pick) continue;
    results[sub.userName] = gradePick(pick.selectedTeam, game);
  }
  return results;
}

export function seasonFromGames(games: NFLGame[]): string {
  if (!games.length) return String(new Date().getFullYear());
  const t = new Date(games[0].commenceTime);
  const month = parseInt(
    t.toLocaleDateString('en-US', { month: 'numeric', timeZone: 'America/New_York' }),
    10,
  );
  const year = parseInt(
    t.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'America/New_York' }),
    10,
  );
  // NFL season spans Jan; picks in Jan–Feb belong to prior season year label
  if (month <= 2) return String(year - 1);
  return String(year);
}

export function formatLockRecord(r: LockRecord): string {
  return r.pushes > 0 ? `${r.wins}-${r.losses}-${r.pushes}` : `${r.wins}-${r.losses}`;
}
