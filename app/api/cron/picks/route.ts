import { POST as refreshLines } from '@/app/api/picks/refresh/route';
import { POST as refreshScores } from '@/app/api/picks/scores/route';
import { POST as gradeWeek } from '@/app/api/picks/grade/route';
import { POST as archiveWeek } from '@/app/api/picks/archive/route';
import { getPicksState, setPicksState } from '@/lib/picks-store';
import { getWeekIssues } from '@/lib/picks-readiness';

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !secret || req.headers.get('authorization') === `Bearer ${secret}`;
}

function internalRequest(path: string, body?: object): Request {
  return new Request(`http://internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function responseBody(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return { status: res.status }; }
}

/**
 * Hourly: refresh unfrozen lines, scores, and the live weekly tally.
 * Wednesday invocation with ?rollover=1 archives the prior week and loads the next.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const requestedRollover = new URL(req.url).searchParams.get('rollover') === '1';
  const before = await getPicksState();
  const rollover = requestedRollover || Boolean(before?.rolloverPending);
  const results: Record<string, unknown> = {};

  if (before?.games.length) {
    results.scores = await responseBody(await refreshScores());
    results.grade = await responseBody(await gradeWeek());
  }

  // Finalize as soon as the last game and every required entry are resolved.
  // The cleared state deliberately waits for Wednesday before loading a new slate.
  const afterGrade = await getPicksState();
  if (afterGrade?.games.length && getWeekIssues(afterGrade).length === 0) {
    const archiveResponse = await archiveWeek();
    results.archive = await responseBody(archiveResponse);
    if (archiveResponse.ok && !rollover) {
      return Response.json({ ok: true, rollover: false, finalized: true, results });
    }
  }

  if (rollover) {
    let current = await getPicksState();
    const nextWeek = Math.min(20, (current?.weekNumber ?? 0) + 1) || 1;
    if (current?.games.length) {
      if (!current.rolloverPending) {
        current = { ...current, rolloverPending: true };
        await setPicksState(current);
      }
      const archiveResponse = await archiveWeek();
      results.archive = await responseBody(archiveResponse);
      if (!archiveResponse.ok) {
        // Keep the old week active. The hourly cron retries after an admin
        // fills missing picks/locks or the remaining score becomes final.
        results.lines = await responseBody(await refreshLines(internalRequest('/api/picks/refresh', { week: current.weekNumber })));
        return Response.json({ ok: false, rollover: true, pending: true, results }, { status: 409 });
      }
    }
    results.lines = await responseBody(await refreshLines(internalRequest('/api/picks/refresh', { week: nextWeek })));
  } else {
    const current = await getPicksState();
    if (!current?.awaitingWednesday) {
      const week = current?.weekNumber ?? before?.weekNumber;
      results.lines = await responseBody(await refreshLines(internalRequest('/api/picks/refresh', week ? { week } : {})));
    }
  }

  return Response.json({ ok: true, rollover, results });
}
