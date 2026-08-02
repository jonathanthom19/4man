import { gradePicksState } from '@/lib/picks-grade-week';
import { seasonFromGames } from '@/lib/picks-grading';
import { archivePicksWeek } from '@/lib/picks-history-store';
import { getPicksState, setPicksState } from '@/lib/picks-store';
import { rebuildSeasonFromArchive, setPicksSeason } from '@/lib/picks-season-store';
import { getPicksHistory, setPicksHistory } from '@/lib/picks-history-store';
import type { ArchivedPicksWeek, PicksState } from '@/lib/types';
import { getWeekIssues } from '@/lib/picks-readiness';
import { withStateLock } from '@/lib/state-lock';

export async function POST() {
  return withStateLock('picks', async () => {
  try {
    const state = await getPicksState();
    if (!state) {
      return Response.json({ error: 'No active picks week to archive' }, { status: 400 });
    }
    if (state.submissions.length === 0) {
      return Response.json({ error: 'No submissions to archive' }, { status: 400 });
    }
    const issues = getWeekIssues(state);
    if (issues.length) {
      return Response.json({
        error: 'Week cannot be archived until every game is final and every member has all picks plus a Lock of the Week.',
        issues,
      }, { status: 409 });
    }

    const graded = gradePicksState(state);
    const season = graded.season ?? seasonFromGames(graded.games);
    const poolDeltas = graded.lastWeeklyPoolDeltas ?? {};
    const fallbackWeekKey = [...graded.games]
      .sort((a, b) => a.commenceTime.localeCompare(b.commenceTime))[0]?.commenceTime.slice(0, 10) ?? graded.weekLabel;
    const archiveId = `${season}-${graded.weekNumber ? `week-${graded.weekNumber}` : fallbackWeekKey}`;

    const history = await getPicksHistory();
    const priorArchive = history.find(h =>
      h.id === archiveId ||
      (h.season === season && (
        (graded.weekNumber != null && h.weekNumber === graded.weekNumber) ||
        h.weekLabel === graded.weekLabel
      )),
    );
    const archive: ArchivedPicksWeek = priorArchive ?? {
      id: archiveId,
      season,
      weekNumber: graded.weekNumber,
      weekLabel: graded.weekLabel,
      archivedAt: Date.now(),
      games: graded.games,
      submissions: graded.submissions,
      sportKey: graded.sportKey,
      weeklyPoolDeltas: poolDeltas,
      balancesAfterWeek: {},
      lockRecordsAfterWeek: {},
      gradedAt: graded.gradedAt ?? Date.now(),
      adminEdits: graded.adminEdits,
    };

    if (!priorArchive) await archivePicksWeek(archive);

    // The archive is the source of truth. Recomputing the ledger means a retry
    // after any partial write produces the same totals instead of adding twice.
    const persistedHistory = await getPicksHistory();
    const seasonWeeks = persistedHistory.filter(week => week.season === season);
    const rebuilt = rebuildSeasonFromArchive(season, seasonWeeks);
    const rebuiltById = new Map(rebuilt.weeks.map(week => [week.id, week]));
    const nextHistory = persistedHistory.map(week => rebuiltById.get(week.id) ?? week);
    const finalizedArchive = rebuiltById.get(archiveId) ?? archive;
    await setPicksHistory(nextHistory);
    await setPicksSeason(rebuilt.seasonState);

    const cleared: PicksState = {
      weekLabel: graded.weekLabel,
      weekNumber: graded.weekNumber,
      games: [],
      gamesRefreshedAt: Date.now(),
      submissions: [],
      season,
      sportKey: graded.sportKey,
      awaitingWednesday: true,
    };
    await setPicksState(cleared);

    return Response.json({ archived: finalizedArchive, state: cleared });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
  });
}
