import {
  getPicksHistory,
  getPicksHistoryBySeason,
  getPicksSeasons,
  setPicksHistory,
} from '@/lib/picks-history-store';
import { isLeagueAdmin } from '@/lib/league-members';
import { gradePicksState } from '@/lib/picks-grade-week';
import { computeLockResults } from '@/lib/picks-grading';
import { setPicksSeason } from '@/lib/picks-season-store';
import type { ArchivedPicksWeek, LockRecord, PicksState } from '@/lib/types';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const season = searchParams.get('season');

    if (season) {
      const weeks = await getPicksHistoryBySeason(season);
      return Response.json({ season, weeks });
    }

    const seasons = await getPicksSeasons();
    const history = await getPicksHistory();
    return Response.json({ seasons, history });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { adminName, archiveId, userName, gameId, selectedTeam, homeSpread } = await req.json() as {
      adminName: string; archiveId: string; userName?: string; gameId: string; selectedTeam?: string; homeSpread?: number;
    };
    if (!isLeagueAdmin(adminName)) return Response.json({ error: 'Admin access required' }, { status: 403 });
    const history = await getPicksHistory();
    const target = history.find(w => w.id === archiveId);
    const game = target?.games.find(g => g.id === gameId);
    if (!target || !game) return Response.json({ error: 'Archived game not found' }, { status: 404 });
    if (selectedTeam && ![game.homeTeam, game.awayTeam].includes(selectedTeam)) return Response.json({ error: 'Invalid team' }, { status: 400 });
    const games = target.games.map(g => g.id === gameId && homeSpread !== undefined ? { ...g, homeSpread } : g);
    const submissions = target.submissions.map(s => s.userName === userName && selectedTeam ? { ...s, picks: [...s.picks.filter(p => p.gameId !== gameId), { gameId, selectedTeam }] } : s);
    const graded = gradePicksState({ weekLabel: target.weekLabel, games, gamesRefreshedAt: target.archivedAt, submissions, season: target.season } satisfies PicksState);
    const edited: ArchivedPicksWeek = { ...target, games: graded.games, submissions: graded.submissions, weeklyPoolDeltas: graded.lastWeeklyPoolDeltas ?? {}, gradedAt: Date.now() };
    const replaced = history.map(w => w.id === archiveId ? edited : w);

    const seasonWeeks = replaced.filter(w => w.season === target.season).sort((a, b) => a.archivedAt - b.archivedAt);
    const balances: Record<string, number> = {};
    const lockRecords: Record<string, LockRecord> = {};
    for (const week of seasonWeeks) {
      for (const [name, delta] of Object.entries(week.weeklyPoolDeltas)) balances[name] = (balances[name] ?? 0) + delta;
      for (const [name, result] of Object.entries(computeLockResults(week.games, week.submissions))) {
        const r = lockRecords[name] ?? { wins: 0, losses: 0, pushes: 0 };
        if (result === 'win') r.wins++; else if (result === 'loss') r.losses++; else if (result === 'push') r.pushes++;
        lockRecords[name] = r;
      }
      week.balancesAfterWeek = { ...balances };
      week.lockRecordsAfterWeek = structuredClone(lockRecords);
    }
    await setPicksHistory(replaced);
    await setPicksSeason({ season: target.season, balances, lockRecords });
    return Response.json({ week: edited });
  } catch (err: unknown) { return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 }); }
}
