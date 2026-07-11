import {
  getPicksHistory,
  getPicksHistoryBySeason,
  getPicksSeasons,
} from '@/lib/picks-history-store';

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
