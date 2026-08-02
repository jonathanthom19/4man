/**
 * Merges final scores from The Odds API into the current picks week.
 */

import { getOddsSportConfig } from '@/lib/odds-sport';
import { getPicksState, setPicksState } from '@/lib/picks-store';
import type { NFLGame } from '@/lib/types';
import { withStateLock } from '@/lib/state-lock';

interface ScoresTeam { name: string; score: string; }
interface ScoresGame {
  id: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: ScoresTeam[] | null;
}

function parseScore(scores: ScoresTeam[] | null, teamName: string): number | null {
  if (!scores) return null;
  const row = scores.find(s => s.name === teamName);
  if (!row?.score) return null;
  const n = parseInt(row.score, 10);
  return Number.isNaN(n) ? null : n;
}

export async function POST() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ODDS_API_KEY environment variable is not set' }, { status: 500 });
  }

  try {
    const sport = getOddsSportConfig();
    const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport.key}/scores/`);
    url.searchParams.set('apiKey', apiKey);
    url.searchParams.set('daysFrom', '3');

    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `Odds API scores error ${res.status}: ${text}` }, { status: 502 });
    }

    const scoresData = await res.json() as ScoresGame[];
    const byId = new Map(scoresData.map(g => [g.id, g]));

    return withStateLock('picks', async () => {
    const state = await getPicksState();
    if (!state?.games.length) {
      return Response.json({ error: 'No active picks week' }, { status: 400 });
    }

    const games: NFLGame[] = state.games.map(game => {
      const remote = byId.get(game.id);
      if (!remote?.completed) return game;

      const homeScore = parseScore(remote.scores, game.homeTeam);
      const awayScore = parseScore(remote.scores, game.awayTeam);

      return {
        ...game,
        homeScore,
        awayScore,
        completed: homeScore != null && awayScore != null,
      };
    });

    const next = { ...state, games };
    await setPicksState(next);
    const completedCount = games.filter(g => g.completed).length;

    return Response.json({
      state: next,
      completedCount,
      remaining: res.headers.get('x-requests-remaining'),
    });
    });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
