import { canonicalMemberName, isLeagueAdmin, isLeagueMember } from '@/lib/league-members';
import { gradePicksState } from '@/lib/picks-grade-week';
import { appendLineHistory } from '@/lib/picks-line-history';
import { getPicksState, setPicksState } from '@/lib/picks-store';
import type { UserPicksSubmission, WeeklyPick } from '@/lib/types';

function isLocked(lockTime: number): boolean {
  return Date.now() >= lockTime;
}

export async function GET(req: Request) {
  try {
    const state = await getPicksState();
    if (!state) return Response.json({ state: null });

    const viewer = canonicalMemberName(new URL(req.url).searchParams.get('viewer') ?? '');
    if (!viewer) return Response.json({ error: 'Valid viewer is required' }, { status: 400 });
    const mine = state.submissions.find(s => s.userName === viewer);
    const visibleGameIds = new Set(mine?.picks.map(p => p.gameId) ?? []);
    const submissions = state.submissions.map(sub => ({
      ...sub,
      picks: sub.userName === viewer
        ? sub.picks
        : sub.picks.filter(p => visibleGameIds.has(p.gameId)),
      lockOfWeekGameId:
        sub.userName === viewer || (sub.lockOfWeekGameId && visibleGameIds.has(sub.lockOfWeekGameId))
          ? sub.lockOfWeekGameId
          : undefined,
    }));
    return Response.json({ state: { ...state, submissions } });
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
    const existing = state.submissions.find(s => s.userName === canonical);

    const lineConflicts = picks.flatMap(pick => {
      const game = state.games.find(g => g.id === pick.gameId);
      if (!game || game.lineLockedAt == null || pick.lineAtPick === game.homeSpread) return [];
      return [`${game.awayTeam} at ${game.homeTeam} (now ${game.homeSpread ?? 'N/A'})`];
    });
    if (lineConflicts.length) {
      return Response.json({
        error: `The line changed for: ${lineConflicts.join(', ')}. Review and reselect those game(s).`,
        games: lineConflicts,
      }, { status: 409 });
    }

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
      if (submitted && !locked && [game.homeTeam, game.awayTeam].includes(submitted.selectedTeam)) {
        return { gameId: game.id, selectedTeam: submitted.selectedTeam, lineAtPick: game.homeSpread };
      }
      // Not submitted yet and not locked — omit (partial picks allowed)
      return null;
    }).filter((p): p is WeeklyPick => p !== null);

    const requestedLockGame = state.games.find(g => g.id === lockOfWeekGameId);
    const existingLockGame = state.games.find(g => g.id === existing?.lockOfWeekGameId);
    const canChangeLock =
      (!requestedLockGame || !isLocked(requestedLockGame.lockTime)) &&
      (!existingLockGame || !isLocked(existingLockGame.lockTime));
    const resolvedLock =
      lockOfWeekGameId !== undefined
        ? (canChangeLock ? lockOfWeekGameId || undefined : existing?.lockOfWeekGameId)
        : existing?.lockOfWeekGameId;

    if (resolvedLock && !mergedPicks.some(p => p.gameId === resolvedLock)) {
      return Response.json({ error: 'Lock of the Week must be one of your saved picks' }, { status: 400 });
    }

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

    const newlyPickedGameIds = new Set(
      mergedPicks
        .filter(p => !state.submissions.some(s => s.picks.some(existingPick => existingPick.gameId === p.gameId)))
        .map(p => p.gameId),
    );
    const games = state.games.map(game => {
      const hasLivePick = submissions.some(s => s.picks.some(p => p.gameId === game.id));
      if (!hasLivePick) return { ...game, lineLockedAt: undefined };
      return newlyPickedGameIds.has(game.id) && game.lineLockedAt == null
        ? { ...game, lineLockedAt: now }
        : game;
    });

    const next = { ...state, games, submissions };
    await setPicksState(next);
    return Response.json({ state: next });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

/** Admin override for a missing/corrected pick or Lock of the Week. */
export async function PUT(req: Request) {
  try {
    const { adminName, userName, gameId, selectedTeam, setAsLock, reason } = await req.json() as {
      adminName: string; userName: string; gameId: string; selectedTeam: string; setAsLock?: boolean; reason?: string;
    };
    if (!isLeagueAdmin(adminName)) {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    const canonical = canonicalMemberName(userName);
    const state = await getPicksState();
    const game = state?.games.find(g => g.id === gameId);
    if (!state || !game || !canonical || ![game.homeTeam, game.awayTeam].includes(selectedTeam)) {
      return Response.json({ error: 'Invalid member, game, or team' }, { status: 400 });
    }
    const now = Date.now();
    const editTiming: 'before-kickoff' | 'after-kickoff' =
      now < new Date(game.commenceTime).getTime() ? 'before-kickoff' : 'after-kickoff';
    const existing = state.submissions.find(s => s.userName === canonical);
    const previousPick = existing?.picks.find(p => p.gameId === gameId);
    const picks = [
      ...(existing?.picks.filter(p => p.gameId !== gameId) ?? []),
      { gameId, selectedTeam },
    ];
    const submission: UserPicksSubmission = {
      userName: canonical,
      submittedAt: existing?.submittedAt ?? now,
      updatedAt: now,
      picks,
      ...(setAsLock ? { lockOfWeekGameId: gameId } : existing?.lockOfWeekGameId
        ? { lockOfWeekGameId: existing.lockOfWeekGameId } : {}),
    };
    const games = state.games.map(existingGame =>
      existingGame.id === gameId && existingGame.lineLockedAt == null
        ? { ...existingGame, lineLockedAt: now }
        : existingGame,
    );
    const next = {
      ...state,
      games,
      submissions: [...state.submissions.filter(s => s.userName !== canonical), submission],
      gradedAt: undefined,
      lastWeeklyPoolDeltas: undefined,
      adminEdits: [
        ...(state.adminEdits ?? []),
        {
          id: `${now}-${canonical}-${gameId}`,
          editedAt: now,
          adminName,
          userName: canonical,
          gameId,
          previousTeam: previousPick?.selectedTeam,
          selectedTeam,
          previousLockGameId: existing?.lockOfWeekGameId,
          setAsLock: Boolean(setAsLock),
          timing: editTiming,
          ...(reason?.trim() ? { reason: reason.trim() } : {}),
        },
      ],
    };
    const regraded = gradePicksState(next);
    await setPicksState(regraded);
    return Response.json({ state: regraded });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

/** Admin line override/unlock for a single active game. */
export async function PATCH(req: Request) {
  try {
    const { adminName, gameId, homeSpread, unlock } = await req.json() as {
      adminName: string; gameId: string; homeSpread?: number | null; unlock?: boolean;
    };
    if (!isLeagueAdmin(adminName)) return Response.json({ error: 'Admin access required' }, { status: 403 });
    const state = await getPicksState();
    const game = state?.games.find(g => g.id === gameId);
    if (!state || !game) return Response.json({ error: 'Game not found' }, { status: 404 });
    const games = state.games.map(g => {
      if (g.id !== gameId) return g;
      const nextSpread = homeSpread !== undefined ? homeSpread : g.homeSpread;
      return {
        ...g,
        ...(homeSpread !== undefined ? {
          homeSpread: nextSpread,
          lineHistory: appendLineHistory(g, nextSpread, 'admin'),
        } : {}),
        ...(unlock ? { lineLockedAt: undefined } : {}),
      };
    });
    const next = gradePicksState({ ...state, games });
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
    const next = {
      ...state,
      submissions: [],
      games: state.games.map(game => ({ ...game, lineLockedAt: undefined })),
    };
    await setPicksState(next);
    return Response.json({ ok: true, state: next });
  } catch (err: unknown) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
