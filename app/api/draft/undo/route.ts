import { getDraftState, setDraftState } from '@/lib/draft-store';

export async function POST() {
  try {
    const state = await getDraftState();
    if (!state) {
      return Response.json({ error: 'No active draft' }, { status: 400 });
    }
    if (state.picks.length === 0) {
      return Response.json({ error: 'No picks to undo' }, { status: 400 });
    }

    const next = {
      ...state,
      picks:       state.picks.slice(0, -1),
      currentPick: state.currentPick - 1,
      updatedAt:   Date.now(),
    };

    await setDraftState(next);
    return Response.json({ state: next });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
