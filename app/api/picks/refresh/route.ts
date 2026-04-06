/**
 * Fetches upcoming NFL games with DraftKings spreads from The Odds API
 * and stores them in KV, preserving existing submissions.
 *
 * Requires env var:  ODDS_API_KEY
 * Get a free key (500 req/month) at https://the-odds-api.com
 */

import { getPicksState, setPicksState } from '@/lib/picks-store';
import { computeLockTime } from '@/lib/picks-utils';
import type { NFLGame, PicksState } from '@/lib/types';

interface OddsOutcome { name: string; price: number; point: number; }
interface OddsMarket  { key: string; outcomes: OddsOutcome[]; }
interface OddsBook    { key: string; markets: OddsMarket[]; }
interface OddsGame    {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: OddsBook[];
}

function weekLabel(games: NFLGame[]): string {
  if (!games.length) return 'NFL Picks';
  const times = games.map(g => new Date(g.commenceTime).getTime());
  const min = new Date(Math.min(...times));
  const max = new Date(Math.max(...times));
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  const year = min.getFullYear();
  return min.getMonth() === max.getMonth()
    ? `${fmt(min)}–${max.getDate()}, ${year}`
    : `${fmt(min)} – ${fmt(max)}, ${year}`;
}

export async function POST() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ODDS_API_KEY environment variable is not set' }, { status: 500 });
  }

  try {
    const url = new URL('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/');
    url.searchParams.set('apiKey',      apiKey);
    url.searchParams.set('regions',     'us');
    url.searchParams.set('markets',     'spreads');
    url.searchParams.set('bookmakers',  'draftkings');
    url.searchParams.set('oddsFormat',  'american');

    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `Odds API error ${res.status}: ${text}` }, { status: 502 });
    }

    const data = await res.json() as OddsGame[];

    const games: NFLGame[] = data
      .map((g): NFLGame => {
        let homeSpread: number | null = null;
        const book = g.bookmakers.find(b => b.key === 'draftkings');
        if (book) {
          const market = book.markets.find(m => m.key === 'spreads');
          if (market) {
            const outcome = market.outcomes.find(o => o.name === g.home_team);
            if (outcome) homeSpread = outcome.point;
          }
        }
        return {
          id:           g.id,
          homeTeam:     g.home_team,
          awayTeam:     g.away_team,
          commenceTime: g.commence_time,
          homeSpread,
          lockTime:     computeLockTime(g.commence_time),
        };
      })
      .sort((a, b) => new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime());

    const current = await getPicksState();
    const next: PicksState = {
      weekLabel:        weekLabel(games),
      games,
      gamesRefreshedAt: Date.now(),
      submissions:      current?.submissions ?? [],
    };

    await setPicksState(next);
    return Response.json({ state: next, remaining: res.headers.get('x-requests-remaining') });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
