import { seasonFromGames } from '@/lib/picks-grading';
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
    return Response.json({ season: seasonState });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
