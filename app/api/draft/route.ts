import { getDraftState, setDraftState, hasKv } from '@/lib/draft-store';
import { archiveDraft } from '@/lib/history-store';
import type { DraftState } from '@/lib/types';

export async function GET() {
  try {
    const state = await getDraftState();
    return Response.json({ state, localMode: !hasKv() });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { managers, rounds, adminName, snakeDraft, draftName } = await req.json() as {
      managers: string[]; rounds: number; adminName?: string; snakeDraft?: boolean; draftName?: string;
    };
    if (!managers?.length || !rounds) {
      return Response.json({ error: 'managers and rounds are required' }, { status: 400 });
    }
    const state: DraftState = {
      managers,
      rounds,
      picks: [],
      currentPick: 1,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      snakeDraft: snakeDraft !== false,
      ...(adminName?.trim()  ? { adminName:  adminName.trim()  } : {}),
      ...(draftName?.trim()  ? { draftName:  draftName.trim()  } : {}),
    };
    await setDraftState(state);
    return Response.json({ state, localMode: !hasKv() });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const updates = await req.json() as Partial<DraftState>;
    const state = await getDraftState();
    if (!state) return Response.json({ error: 'No active draft' }, { status: 400 });
    const next: DraftState = { ...state, ...updates, updatedAt: Date.now() };
    await setDraftState(next);
    return Response.json({ state: next });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const current = await getDraftState();
    if (current) await archiveDraft(current);
    await setDraftState(null);
    return Response.json({ ok: true });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
