import { gradePick, aggregatePoolDeltas, seasonFromGames } from './picks-grading';
import type { PicksState, UserPicksSubmission } from './types';
import { LEAGUE_MEMBERS } from './league-members';

/** Attach ATS results to picks and mark games completed from scores. */
export function gradePicksState(state: PicksState): PicksState {
  const season = state.season ?? seasonFromGames(state.games);

  const games = state.games.map(game => ({
    ...game,
    completed: game.completed ?? (game.homeScore != null && game.awayScore != null),
  }));

  const submissions: UserPicksSubmission[] = state.submissions.map(sub => ({
    ...sub,
    picks: sub.picks.map(p => {
      const game = games.find(g => g.id === p.gameId);
      const allSubmitted = game && LEAGUE_MEMBERS.every(user =>
        state.submissions.find(s => s.userName === user)?.picks.some(entry => entry.gameId === game.id),
      );
      return game
        ? { ...p, result: allSubmitted ? gradePick(p.selectedTeam, game) : 'pending' }
        : p;
    }),
  }));

  const poolDeltas = aggregatePoolDeltas(games, submissions);

  return {
    ...state,
    season,
    games,
    submissions,
    lastWeeklyPoolDeltas: poolDeltas,
    gradedAt: Date.now(),
  };
}
