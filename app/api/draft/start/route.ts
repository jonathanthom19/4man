import { getDraftState, setDraftState } from '@/lib/draft-store';
import { isLeagueAdmin } from '@/lib/league-members';
import { withStateLock } from '@/lib/state-lock';

export async function POST(req: Request) {
  return withStateLock('draft', async () => {
    try {
      const { adminName } = await req.json() as { adminName?: string };
      const state = await getDraftState();
      const allowed = Boolean(adminName && (
        isLeagueAdmin(adminName) || state?.adminName?.toLowerCase() === adminName.toLowerCase()
      ));
      if (!allowed) return Response.json({ error: 'Admin access required' }, { status: 403 });
      if (!state) return Response.json({ error: 'No current draft' }, { status: 404 });
      if ((state.status ?? 'active') !== 'scheduled') {
        return Response.json({ error: 'Draft has already started' }, { status: 409 });
      }
      const now = Date.now();
      const next = { ...state, status: 'active' as const, draftStartedAt: now, updatedAt: now };
      await setDraftState(next);
      return Response.json({ state: next });
    } catch (err: unknown) {
      return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
    }
  });
}
