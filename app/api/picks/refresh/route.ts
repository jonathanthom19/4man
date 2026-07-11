/**
 * Fetches upcoming games with DraftKings spreads from The Odds API
 * and stores them in KV, preserving existing submissions.
 *
 * Requires env var:  ODDS_API_KEY
 * Optional:         ODDS_SPORT_KEY (default americanfootball_nfl; use basketball_nba to test off-season)
 * Body (optional):   { "week": 1 } — NFL week to load (default 1)
 * Get a free key (500 req/month) at https://the-odds-api.com
 */

import { getOddsSportConfig } from '@/lib/odds-sport';
import {
  detectCurrentNflWeek,
  filterGamesForNflWeek,
  formatNflWeekLabel,
  nflWeekCount,
} from '@/lib/nfl-week';
import { seasonFromGames } from '@/lib/picks-grading';
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

function weekLabel(games: NFLGame[], sportLabel: string): string {
  if (!games.length) return `${sportLabel} Picks`;
  const times = games.map(g => new Date(g.commenceTime).getTime());
  const min = new Date(Math.min(...times));
  const max = new Date(Math.max(...times));
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  const year = min.getFullYear();
  const range = min.getMonth() === max.getMonth()
    ? `${fmt(min)}–${max.getDate()}, ${year}`
    : `${fmt(min)} – ${fmt(max)}, ${year}`;
  return `${sportLabel} Picks · ${range}`;
}

function parseWeek(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const week = (body as { week?: unknown }).week;
  if (typeof week !== 'number' || !Number.isInteger(week) || week < 1 || week > 22) return undefined;
  return week;
}

function parseManual(body: unknown): boolean {
  return Boolean(body && typeof body === 'object' && (body as { manual?: unknown }).manual === true);
}

export async function POST(req: Request) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ODDS_API_KEY environment variable is not set' }, { status: 500 });
  }

  let requestedWeek: number | undefined;
  let manual = false;
  try {
    const body = await req.json();
    requestedWeek = parseWeek(body);
    manual = parseManual(body);
  } catch {
    requestedWeek = undefined;
  }

  try {
    const sport = getOddsSportConfig();
    const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport.key}/odds/`);
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

    const current = await getPicksState();
    const priorById = new Map((current?.games ?? []).map(g => [g.id, g]));

    const fetchedGames: NFLGame[] = data
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
        const prior = priorById.get(g.id);
        const spreadFrozen = prior?.lineLockedAt != null && !manual;
        return {
          id:           g.id,
          homeTeam:     g.home_team,
          awayTeam:     g.away_team,
          commenceTime: g.commence_time,
          homeSpread: spreadFrozen ? prior.homeSpread : homeSpread,
          lineLockedAt: prior?.lineLockedAt,
          lockTime:     computeLockTime(g.commence_time),
          homeScore:    prior?.homeScore,
          awayScore:    prior?.awayScore,
          completed:    prior?.completed,
        };
      })
    // The odds feed generally contains upcoming games only. Retain current-week
    // games that disappeared from that feed after kickoff so scores and picks
    // are never lost during an automatic line refresh.
    const fetchedIds = new Set(fetchedGames.map(g => g.id));
    const allGames = [
      ...fetchedGames,
      ...(current?.games ?? []).filter(g => !fetchedIds.has(g.id)),
    ].sort((a, b) => new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime());

    let games = allGames;
    let weekNumber: number | undefined;

    if (sport.useNflSundayLockRules) {
      const availableWeeks = nflWeekCount(allGames);
      weekNumber = requestedWeek
        ?? current?.weekNumber
        ?? detectCurrentNflWeek(allGames);
      games = filterGamesForNflWeek(allGames, weekNumber);

      if (!games.length) {
        return Response.json({
          error: `No games for NFL week ${weekNumber} (${availableWeeks} week${availableWeeks === 1 ? '' : 's'} available from Odds API)`,
        }, { status: 400 });
      }
    }

    const label = weekNumber
      ? formatNflWeekLabel(games, sport.label, weekNumber)
      : weekLabel(games, sport.label);

    const next: PicksState = {
      weekLabel:        label,
      weekNumber,
      games,
      gamesRefreshedAt: Date.now(),
      submissions:      current?.submissions ?? [],
      sportKey:         sport.key,
      season:           current?.season ?? seasonFromGames(games),
      gradedAt:         current?.gradedAt,
      lastWeeklyPoolDeltas: current?.lastWeeklyPoolDeltas,
      rolloverPending: current?.rolloverPending,
      adminEdits: current?.adminEdits,
    };

    await setPicksState(next);
    return Response.json({
      state: next,
      remaining: res.headers.get('x-requests-remaining'),
      sport: sport.label,
      weekNumber,
      totalGamesFromApi: allGames.length,
    });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
