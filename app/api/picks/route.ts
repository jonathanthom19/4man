import { canonicalMemberName, isLeagueMember } from '@/lib/league-members';
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
    const { userName, picks, lockOfWeekGameId } = await req.json() as {
      userName: string;
      picks: WeeklyPick[];
      lockOfWeekGameId?: string;
    };
    if (!userName || !Array.isArray(picks)) {
      return Response.json({ error: 'userName and picks are required' }, { status: 400 });
    }
    const canonical = canonicalMemberName(userName);
    if (!canonical || !isLeagueMember(canonical)) {
      return Response.json({ error: 'Invalid league member' }, { status: 400 });
    }
    if (lockOfWeekGameId && !picks.some(p => p.gameId === lockOfWeekGameId)) {
      return Response.json({ error: 'Lock of the Week must be one of your picks' }, { status: 400 });
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

    const resolvedLock =
      lockOfWeekGameId !== undefined
        ? lockOfWeekGameId || undefined
        : existing?.lockOfWeekGameId;

    const submission: UserPicksSubmission = {
      userName: canonical,
      submittedAt: existing?.submittedAt ?? now,
      updatedAt:   now,
      picks:       mergedPicks,
      ...(resolvedLock ? { lockOfWeekGameId: resolvedLock } : {}),
    };

    const submissions = [
      ...state.submissions.filter(s => s.userName !== canonical),
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
