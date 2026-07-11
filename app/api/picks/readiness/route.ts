import { isLeagueAdmin } from '@/lib/league-members';
import { getWeekIssues } from '@/lib/picks-readiness';
import { getPicksState } from '@/lib/picks-store';

export async function GET(req: Request) {
  const adminName = new URL(req.url).searchParams.get('adminName') ?? '';
  if (!isLeagueAdmin(adminName)) {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }
  const state = await getPicksState();
  return Response.json({
    issues: state ? getWeekIssues(state) : [],
    edits: state?.adminEdits ?? [],
    rolloverPending: Boolean(state?.rolloverPending),
  });
}
