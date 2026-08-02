import { gradePicksState } from '@/lib/picks-grade-week';
import { seasonFromGames } from '@/lib/picks-grading';
import { getPicksState, setPicksState } from '@/lib/picks-store';
import { getPicksSeason } from '@/lib/picks-season-store';
import { withStateLock } from '@/lib/state-lock';

export async function POST() {
  return withStateLock('picks', async () => {
  try {
    const state = await getPicksState();
    if (!state) {
      return Response.json({ error: 'No active picks week' }, { status: 400 });
    }

    const graded = gradePicksState(state);
    const season = graded.season ?? seasonFromGames(graded.games);
    const seasonState = await getPicksSeason(season);

    await setPicksState(graded);

    return Response.json({ state: graded, season: seasonState });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
  });
}
