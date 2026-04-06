import { getPicksState, setPicksState } from '@/lib/picks-store';
import type { UserPicksSubmission, WeeklyPick } from '@/lib/types';

function isLocked(lockTime: number): boolean {
  return Date.now() >= lockTime;
}

export async function GET() {
  try {
    const state = await getPicksState();
    return Response.json({ state });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userName, picks } = await req.json() as { userName: string; picks: WeeklyPick[] };
    if (!userName || !Array.isArray(picks)) {
      return Response.json({ error: 'userName and picks are required' }, { status: 400 });
    }

    const state = await getPicksState();
    if (!state) {
      return Response.json({ error: 'No picks week is active. Ask Jon to refresh the games.' }, { status: 400 });
    }

    const now = Date.now();
    const existing = state.submissions.find(s => s.userName === userName);

    // Build a map of previously submitted picks so we can preserve locked ones
    const existingPickMap = new Map<string, string>();
    existing?.picks.forEach(p => existingPickMap.set(p.gameId, p.selectedTeam));

    // For each game: if locked, keep the existing pick; otherwise use submitted pick
    const mergedPicks: WeeklyPick[] = state.games.map(game => {
      const locked      = isLocked(game.lockTime);
      const existingPick = existingPickMap.get(game.id);
      const submitted   = picks.find(p => p.gameId === game.id);

      if (locked && existingPick) {
        // Game is locked — preserve the existing pick regardless of what was submitted
        return { gameId: game.id, selectedTeam: existingPick };
      }
      if (submitted) {
        return { gameId: game.id, selectedTeam: submitted.selectedTeam };
      }
      // Not submitted yet and not locked — omit (partial picks allowed)
      return null;
    }).filter((p): p is WeeklyPick => p !== null);

    const submission: UserPicksSubmission = {
      userName,
      submittedAt: existing?.submittedAt ?? now,
      updatedAt:   now,
      picks:       mergedPicks,
    };

    const submissions = [
      ...state.submissions.filter(s => s.userName !== userName),
      submission,
    ].sort((a, b) => a.submittedAt - b.submittedAt);

    const next = { ...state, submissions };
    await setPicksState(next);
    return Response.json({ state: next });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

// Admin: wipe all submissions to start a fresh week
export async function DELETE() {
  try {
    const state = await getPicksState();
    if (!state) return Response.json({ ok: true });
    const next = { ...state, submissions: [] };
    await setPicksState(next);
    return Response.json({ ok: true, state: next });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
