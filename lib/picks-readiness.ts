import { LEAGUE_MEMBERS } from './league-members';
import type { PicksState } from './types';

export interface WeekIssue {
  userName?: string;
  gameId?: string;
  message: string;
}

/** A week cannot enter the season ledger until every result and entry is final. */
export function getWeekIssues(state: PicksState): WeekIssue[] {
  const issues: WeekIssue[] = [];
  for (const game of state.games) {
    if (!game.completed || game.homeScore == null || game.awayScore == null) {
      issues.push({ gameId: game.id, message: `${game.awayTeam} at ${game.homeTeam} is not final` });
    }
  }
  for (const userName of LEAGUE_MEMBERS) {
    const submission = state.submissions.find(s => s.userName === userName);
    if (!submission) {
      issues.push({ userName, message: `${userName} has not submitted picks` });
      continue;
    }
    for (const game of state.games) {
      if (!submission.picks.some(p => p.gameId === game.id)) {
        issues.push({ userName, gameId: game.id, message: `${userName} is missing ${game.awayTeam} at ${game.homeTeam}` });
      }
    }
    if (!submission.lockOfWeekGameId || !submission.picks.some(p => p.gameId === submission.lockOfWeekGameId)) {
      issues.push({ userName, message: `${userName} is missing a Lock of the Week` });
    }
  }
  return issues;
}
