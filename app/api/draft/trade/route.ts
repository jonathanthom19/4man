import { getDraftState, setDraftState } from '@/lib/draft-store';
import { isLeagueAdmin } from '@/lib/league-members';
import { withStateLock } from '@/lib/state-lock';

function slotForPick(pick: number, managers: number, snake: boolean): number {
  const zero = pick - 1;
  const round = Math.floor(zero / managers);
  const position = zero % managers;
  return snake && round % 2 !== 0 ? managers - 1 - position : position;
}

export async function POST(req: Request) {
  return withStateLock('draft', async () => {
    try {
      const { adminName, firstPick, secondPick } = await req.json() as {
        adminName?: string; firstPick?: number; secondPick?: number;
      };
      const state = await getDraftState();
      const allowed = Boolean(adminName && (
        isLeagueAdmin(adminName) || state?.adminName?.toLowerCase() === adminName.toLowerCase()
      ));
      if (!allowed) return Response.json({ error: 'Admin access required' }, { status: 403 });
      if (!state) return Response.json({ error: 'No current draft' }, { status: 404 });
      if ((state.status ?? 'active') !== 'scheduled') {
        return Response.json({ error: 'Pick trades close when the draft starts' }, { status: 409 });
      }
      const total = state.managers.length * state.rounds;
      if (!Number.isInteger(firstPick) || !Number.isInteger(secondPick) || !firstPick || !secondPick ||
          firstPick < 1 || secondPick < 1 || firstPick > total || secondPick > total || firstPick === secondPick) {
        return Response.json({ error: 'Choose two different valid picks' }, { status: 400 });
      }
      const baseOwner = (pick: number) => state.managers[
        slotForPick(pick, state.managers.length, state.snakeDraft !== false)
      ];
      const owners = { ...(state.pickOwners ?? {}) };
      const firstOwner = owners[String(firstPick)] ?? baseOwner(firstPick);
      const secondOwner = owners[String(secondPick)] ?? baseOwner(secondPick);
      owners[String(firstPick)] = secondOwner;
      owners[String(secondPick)] = firstOwner;
      const next = { ...state, pickOwners: owners, updatedAt: Date.now() };
      await setDraftState(next);
      return Response.json({ state: next });
    } catch (err: unknown) {
      return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
    }
  });
}
