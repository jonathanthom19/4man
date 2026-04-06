import { getDraftState, setDraftState } from '@/lib/draft-store';
import type { Player, DraftedPlayer } from '@/lib/types';

function slotForPick(pick: number, n: number, snake = true): number {
  const zero  = pick - 1;
  const round = Math.floor(zero / n);
  const pos   = zero % n;
  return snake && round % 2 !== 0 ? n - 1 - pos : pos;
}

export async function POST(req: Request) {
  try {
    const { player, managerName } = await req.json() as { player: Player; managerName: string };

    const state = await getDraftState();
    if (!state) {
      return Response.json({ error: 'No active draft' }, { status: 400 });
    }

    const totalPicks = state.managers.length * state.rounds;
    if (state.currentPick > totalPicks) {
      return Response.json({ error: 'Draft is already complete' }, { status: 400 });
    }

    const expectedSlot   = slotForPick(state.currentPick, state.managers.length, state.snakeDraft !== false);
    const expectedManager = state.managers[expectedSlot];
    if (managerName !== expectedManager) {
      return Response.json({ error: `It is ${expectedManager}'s turn, not ${managerName}'s` }, { status: 403 });
    }

    if (state.picks.some(p => p.player_id === player.player_id)) {
      return Response.json({ error: 'Player already drafted' }, { status: 400 });
    }

    const pick: DraftedPlayer = {
      ...player,
      manager:    managerName,
      pickNumber: state.currentPick,
      round:      Math.ceil(state.currentPick / state.managers.length),
    };

    const next = {
      ...state,
      picks:       [...state.picks, pick],
      currentPick: state.currentPick + 1,
      updatedAt:   Date.now(),
    };

    await setDraftState(next);
    return Response.json({ state: next });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
