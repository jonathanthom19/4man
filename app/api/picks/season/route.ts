import { computeLockResults, seasonFromGames } from '@/lib/picks-grading';
import { getPicksState } from '@/lib/picks-store';
import { getPicksSeason } from '@/lib/picks-season-store';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const current = await getPicksState();
    const season =
      searchParams.get('season') ??
      current?.season ??
      (current?.games.length ? seasonFromGames(current.games) : String(new Date().getFullYear()));

    const seasonState = await getPicksSeason(season);
    if (!current || current.season !== season || !current.games.length) {
      return Response.json({ season: seasonState });
    }

    // Include finalized Lock results from the active week for display without
    // persisting them twice when the week is archived.
    const lockRecords = { ...seasonState.lockRecords };
    for (const [user, result] of Object.entries(computeLockResults(current.games, current.submissions))) {
      if (result === 'pending') continue;
      const record = lockRecords[user] ?? { wins: 0, losses: 0, pushes: 0 };
      lockRecords[user] = {
        wins: record.wins + (result === 'win' ? 1 : 0),
        losses: record.losses + (result === 'loss' ? 1 : 0),
        pushes: record.pushes + (result === 'push' ? 1 : 0),
      };
    }
    return Response.json({ season: { ...seasonState, lockRecords } });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
