import { gradePicksState } from '@/lib/picks-grade-week';
import { computeLockResults, seasonFromGames } from '@/lib/picks-grading';
import { archivePicksWeek } from '@/lib/picks-history-store';
import { getPicksState, setPicksState } from '@/lib/picks-store';
import { applyWeeklySeasonUpdate } from '@/lib/picks-season-store';
import { getPicksHistory } from '@/lib/picks-history-store';
import type { ArchivedPicksWeek, PicksState } from '@/lib/types';

export async function POST() {
  try {
    const state = await getPicksState();
    if (!state) {
      return Response.json({ error: 'No active picks week to archive' }, { status: 400 });
    }
    if (state.submissions.length === 0) {
      return Response.json({ error: 'No submissions to archive' }, { status: 400 });
    }

    const graded = gradePicksState(state);
    const season = graded.season ?? seasonFromGames(graded.games);
    const poolDeltas = graded.lastWeeklyPoolDeltas ?? {};
    const archiveId = `${season}-${graded.gamesRefreshedAt}`;

    const existing = await getPicksHistory();
    if (existing.some(h => h.id === archiveId)) {
      return Response.json({ error: 'This week is already archived' }, { status: 400 });
    }

    const lockResults = computeLockResults(graded.games, graded.submissions);
    const seasonState = await applyWeeklySeasonUpdate(season, poolDeltas, lockResults);

    const archive: ArchivedPicksWeek = {
      id: archiveId,
      season,
      weekLabel: graded.weekLabel,
      archivedAt: Date.now(),
      games: graded.games,
      submissions: graded.submissions,
      sportKey: graded.sportKey,
      weeklyPoolDeltas: poolDeltas,
      balancesAfterWeek: { ...seasonState.balances },
      lockRecordsAfterWeek: { ...seasonState.lockRecords },
      gradedAt: graded.gradedAt ?? Date.now(),
    };

    await archivePicksWeek(archive);

    const cleared: PicksState = {
      weekLabel: graded.weekLabel,
      games: [],
      gamesRefreshedAt: Date.now(),
      submissions: [],
      season,
      sportKey: graded.sportKey,
    };
    await setPicksState(cleared);

    return Response.json({ archived: archive, state: cleared });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
