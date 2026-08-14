'use client';

import { useState, useEffect, useCallback } from 'react';
import { espnTeamLogoUrl } from '@/lib/odds-sport';
import { LEAGUE_MEMBERS, isLeagueAdmin } from '@/lib/league-members';
import { matchupLine, mascot } from '@/lib/picks-display';
import { formatHomeSpread } from '@/lib/picks-line-history';
import PicksWeekTable from './PicksWeekTable';
import { formatLockRecord } from '@/lib/picks-grading';
import { lockCountdown } from '@/lib/picks-utils';
import type {
  ArchivedPicksWeek,
  LineHistoryEntry,
  PicksAdminEdit,
  NFLGame,
  PicksSeasonState,
  PicksState,
  WeeklyPick,
  UserPicksSubmission,
} from '@/lib/types';
import type { WeekIssue } from '@/lib/picks-readiness';

function gameTimeLabel(game: NFLGame): string {
  return new Date(game.commenceTime).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    timeZone: 'America/New_York',
  });
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'numeric', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

function lineHistorySourceLabel(source: LineHistoryEntry['source']): string {
  if (source === 'open') return 'Opened';
  if (source === 'admin') return 'Admin edit';
  return 'Line move';
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetchPicks(viewer: string): Promise<PicksState | null> {
  const res  = await fetch(`/api/picks?viewer=${encodeURIComponent(viewer)}`);
  const data = await res.json();
  return data.state ?? null;
}

async function apiFetchSeason(season?: string): Promise<PicksSeasonState | null> {
  const q = season ? `?season=${encodeURIComponent(season)}` : '';
  const res  = await fetch(`/api/picks/season${q}`);
  const data = await res.json();
  return data.season ?? null;
}

async function apiFetchHistory(): Promise<{ seasons: string[]; history: ArchivedPicksWeek[] }> {
  const res  = await fetch('/api/picks/history');
  const data = await res.json();
  return { seasons: data.seasons ?? [], history: data.history ?? [] };
}

async function apiFetchReadiness(adminName: string): Promise<{ issues: WeekIssue[]; edits: PicksAdminEdit[]; rolloverPending: boolean }> {
  const res = await fetch(`/api/picks/readiness?adminName=${encodeURIComponent(adminName)}`);
  if (!res.ok) return { issues: [], edits: [], rolloverPending: false };
  return res.json();
}
async function apiEditArchive(adminName: string, archiveId: string, userName: string, gameId: string, selectedTeam: string): Promise<ArchivedPicksWeek> {
  const res = await fetch('/api/picks/history', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminName, archiveId, userName, gameId, selectedTeam }) });
  const data = await res.json(); if (!res.ok) throw new Error(data.error ?? 'Archive edit failed'); return data.week;
}

async function apiSubmitPicks(
  userName: string,
  picks: WeeklyPick[],
  lockOfWeekGameId?: string,
): Promise<PicksState> {
  const res  = await fetch('/api/picks', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    // Send an empty value explicitly so removing a selected Lock is persisted.
    body:    JSON.stringify({ userName, picks, lockOfWeekGameId: lockOfWeekGameId ?? '' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Submit failed');
  return data.state;
}

async function apiRefreshGames(week: number, preseason = false): Promise<PicksState> {
  const res  = await fetch('/api/picks/refresh', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ week, manual: true, preseason }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Refresh failed');
  return data.state;
}

async function apiFetchScores(): Promise<PicksState> {
  const res  = await fetch('/api/picks/scores', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Scores fetch failed');
  return data.state;
}

async function apiGrade(): Promise<{ state: PicksState; season: PicksSeasonState }> {
  const res  = await fetch('/api/picks/grade', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Grade failed');
  return data;
}

async function apiArchive(): Promise<{ state: PicksState; archived: ArchivedPicksWeek }> {
  const res  = await fetch('/api/picks/archive', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Archive failed');
  return data;
}

async function apiClearPicks(): Promise<PicksState | null> {
  const res  = await fetch('/api/picks', { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Clear failed');
  return data.state ?? null;
}

async function apiAdminEditPick(adminName: string, userName: string, gameId: string, selectedTeam: string, setAsLock: boolean, reason: string): Promise<void> {
  const res = await fetch('/api/picks', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminName, userName, gameId, selectedTeam, setAsLock, reason }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Manual edit failed');
}

async function apiAdminUnlockLine(adminName: string, gameId: string): Promise<void> {
  const res = await fetch('/api/picks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminName, gameId, unlock: true }) });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Unlock failed');
}

async function apiSeedGames(): Promise<PicksState> {
  const res  = await fetch('/api/picks/seed', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Seed failed');
  return data.state;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen = 'home' | 'make' | 'view' | 'history' | 'archiveView';

// ─── PicksBoard ───────────────────────────────────────────────────────────────

export default function PicksBoard({
  myName, dark, onLeave, onToggleDark,
}: {
  myName: string;
  dark:   boolean;
  onLeave: () => void;
  onToggleDark: () => void;
}) {
  const admin = isLeagueAdmin(myName);

  const [screen,            setScreen]            = useState<Screen>('home');
  const [picksState,        setPicksState]        = useState<PicksState | null>(null);
  const [seasonState,       setSeasonState]       = useState<PicksSeasonState | null>(null);
  const [history,           setHistory]           = useState<ArchivedPicksWeek[]>([]);
  const [archivedWeek,      setArchivedWeek]      = useState<ArchivedPicksWeek | null>(null);
  const [draftPicks,        setDraftPicks]        = useState<Record<string, string>>({});
  const [lockOfWeekGameId,  setLockOfWeekGameId]  = useState<string | undefined>();
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState<string | null>(null);
  const [success,           setSuccess]           = useState<string | null>(null);
  const [confirmClear,      setConfirmClear]      = useState(false);
  const [confirmArchive,    setConfirmArchive]    = useState(false);
  const [nflWeek,           setNflWeek]           = useState(1);
  const [loadPreseason,     setLoadPreseason]     = useState(false);
  const [now,               setNow]               = useState(() => Date.now());
  const [editUser,          setEditUser]          = useState<string>(LEAGUE_MEMBERS[0]);
  const [editGameId,        setEditGameId]        = useState('');
  const [editTeam,          setEditTeam]          = useState('');
  const [editAsLock,        setEditAsLock]        = useState(false);
  const [editReason,        setEditReason]        = useState('');
  const [weekIssues,        setWeekIssues]        = useState<WeekIssue[]>([]);
  const [adminEdits,        setAdminEdits]        = useState<PicksAdminEdit[]>([]);
  const [rolloverPending,   setRolloverPending]   = useState(false);
  const [lineHistoryGame,   setLineHistoryGame]   = useState<NFLGame | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const state = await apiFetchPicks(myName);
      setPicksState(state);
      if (state?.weekNumber) setNflWeek(state.weekNumber);

      const seasonKey = state?.season;
      const [season, hist] = await Promise.all([
        apiFetchSeason(seasonKey),
        apiFetchHistory(),
      ]);
      setSeasonState(season);
      setHistory(hist.history);
      if (admin) {
        const readiness = await apiFetchReadiness(myName);
        setWeekIssues(readiness.issues);
        setAdminEdits(readiness.edits);
        setRolloverPending(readiness.rolloverPending);
      }

      if (state) {
        const mine = state.submissions.find(s => s.userName === myName);
        if (mine) {
          const map: Record<string, string> = {};
          mine.picks.forEach(p => { map[p.gameId] = p.selectedTeam; });
          setDraftPicks(map);
          setLockOfWeekGameId(mine.lockOfWeekGameId);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [myName, admin]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    if (!picksState) return;
    const existingSubmission = picksState.submissions.find(s => s.userName === myName);
    if (!Object.keys(draftPicks).length && !existingSubmission) {
      setError('Make at least one pick before saving.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const picks: WeeklyPick[] = Object.entries(draftPicks).map(([gameId, selectedTeam]) => ({
        gameId, selectedTeam,
        lineAtPick: picksState.games.find(g => g.id === gameId)?.homeSpread ?? null,
      }));
      const next = await apiSubmitPicks(myName, picks, lockOfWeekGameId);
      setPicksState(next);
      setSuccess('Picks submitted!');
      setScreen('view');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await apiRefreshGames(nflWeek, loadPreseason);
      setPicksState(next);
      if (next.weekNumber) setNflWeek(next.weekNumber);
      setSuccess(`${next.weekLabel} — ${next.games.length} games with DraftKings spreads.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setLoading(false);
    }
  };

  const handleScores = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await apiFetchScores();
      setPicksState(next);
      const n = next.games.filter(g => g.completed).length;
      setSuccess(`Scores updated — ${n} / ${next.games.length} games final.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scores failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGrade = async () => {
    setLoading(true);
    setError(null);
    try {
      const { state, season } = await apiGrade();
      setPicksState(state);
      setSeasonState(season);
      setSuccess('Week graded — pool totals updated (not archived yet).');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Grade failed');
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async () => {
    setConfirmArchive(false);
    setLoading(true);
    setError(null);
    try {
      const { state, archived } = await apiArchive();
      setPicksState(state);
      setDraftPicks({});
      setLockOfWeekGameId(undefined);
      setArchivedWeek(archived);
      setSuccess(`Archived ${archived.weekLabel} — season ledger updated.`);
      await load();
      setScreen('archiveView');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archive failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setConfirmClear(false);
    setLoading(true);
    setError(null);
    try {
      const next = await apiClearPicks();
      setPicksState(next);
      setDraftPicks({});
      setLockOfWeekGameId(undefined);
      setSuccess('Submissions cleared (games kept).');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clear failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await apiSeedGames();
      setPicksState(next);
      setDraftPicks({});
      setLockOfWeekGameId(undefined);
      setSuccess('Test games loaded.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seed failed');
    } finally {
      setLoading(false);
    }
  };

  const handleManualEdit = async () => {
    if (!editGameId || !editTeam) return;
    setLoading(true); setError(null);
    try {
      await apiAdminEditPick(myName, editUser, editGameId, editTeam, editAsLock, editReason);
      setSuccess(`Saved ${editUser}'s manual pick.`);
      setEditAsLock(false);
      setEditReason('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Manual edit failed');
    } finally { setLoading(false); }
  };

  const mySubmission: UserPicksSubmission | undefined =
    picksState?.submissions.find(s => s.userName === myName);

  const lockedGames       = picksState?.games.filter(g => now >= g.lockTime) ?? [];
  const allLocked         = picksState ? lockedGames.length === picksState.games.length : false;
  const completedGames    = picksState?.games.filter(g => g.completed).length ?? 0;

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">

        <nav className="shrink-0 bg-slate-900 flex items-center gap-3 px-4 py-2.5 flex-wrap">
          <button onClick={onLeave} className="text-slate-400 hover:text-white text-xs transition-colors">← Back</button>
          <div className="w-px h-4 bg-slate-700" />
          <span className="font-bold text-sm text-white tracking-tight">Weekly Picks</span>
          {picksState && (
            <>
              <span className="text-slate-500 text-xs">·</span>
              <span className="text-slate-300 text-xs font-medium max-w-[200px] truncate">{picksState.weekLabel}</span>
            </>
          )}
          <div className="flex-1" />
          <button
            onClick={() => { setArchivedWeek(null); setScreen('history'); }}
            className={`text-xs px-2 py-1 rounded ${screen === 'history' || screen === 'archiveView' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            History
          </button>
          <span className="text-xs text-slate-300 font-medium">{myName}</span>
          {admin && <span className="text-[10px] text-amber-500 bg-amber-950/40 px-1.5 py-0.5 rounded font-semibold">admin</span>}
          <button type="button" onClick={onToggleDark} className="w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors" aria-label="Toggle dark mode">
            {dark ? '☀' : '☾'}
          </button>
        </nav>

        {error && (
          <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-red-600 text-white text-sm font-medium">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-white/70 hover:text-white text-lg leading-none">✕</button>
          </div>
        )}
        {success && (
          <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium">
            <span className="flex-1">{success}</span>
            <button onClick={() => setSuccess(null)} className="text-white/70 hover:text-white text-lg leading-none">✕</button>
          </div>
        )}

        <div className="flex-1 flex flex-col">

          {/* ── Home ──────────────────────────────────────────────────────── */}
          {screen === 'home' && (
            <div className="flex-1 flex flex-col items-center p-6 gap-6 max-w-lg mx-auto w-full">
              {loading && <p className="text-slate-600 dark:text-slate-400 text-sm animate-pulse">Loading…</p>}

              {!loading && !picksState?.games.length && (
                <div className="text-center space-y-2">
                  <p className="text-slate-600 dark:text-slate-400 text-sm">No games loaded yet.</p>
                  {admin && <p className="text-slate-500 text-xs">Refresh lines or load test data.</p>}
                </div>
              )}

              {!loading && picksState && picksState.games.length > 0 && (
                <div className="text-center space-y-1 w-full">
                  <h2 className="text-xl font-black text-slate-900 dark:text-slate-100">{picksState.weekLabel}</h2>
                  <p className="text-slate-500 dark:text-slate-400 text-sm">
                    {picksState.games.length} games · {picksState.submissions.length} / {LEAGUE_MEMBERS.length} submitted
                    {completedGames > 0 && ` · ${completedGames} final`}
                  </p>
                  {mySubmission && (
                    <p className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                      ✓ You submitted · {formatTs(mySubmission.updatedAt)}
                    </p>
                  )}
                  <p className="text-xs text-slate-500">
                    {mySubmission?.picks.length ?? 0} of {picksState.games.length} picks saved · {mySubmission?.lockOfWeekGameId ? 'Lock selected' : 'Lock missing'}
                  </p>
                  {picksState.gradedAt && picksState.lastWeeklyPoolDeltas && (
                    <p className="text-xs text-slate-500">
                      Graded · your week:{' '}
                      {(picksState.lastWeeklyPoolDeltas[myName] ?? 0) >= 0 ? '+' : ''}
                      {picksState.lastWeeklyPoolDeltas[myName] ?? 0}$
                    </p>
                  )}
                </div>
              )}

              {seasonState && (
                <div className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                  <div className="px-4 py-2 bg-slate-800 text-white text-xs font-semibold">
                    {seasonState.season} Season — Pool Standings
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b border-slate-100 dark:border-slate-800">
                        <th className="px-4 py-2">Player</th>
                        <th className="px-4 py-2">Week</th>
                        <th className="px-4 py-2">Season Total</th>
                        <th className="px-4 py-2">Lock W-L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...LEAGUE_MEMBERS]
                        .sort((a, b) => ((seasonState.balances[b] ?? 0) + (picksState?.lastWeeklyPoolDeltas?.[b] ?? 0)) - ((seasonState.balances[a] ?? 0) + (picksState?.lastWeeklyPoolDeltas?.[a] ?? 0)))
                        .map(name => (
                          <tr key={name} className={`border-b border-slate-50 dark:border-slate-800/50 ${name === myName ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}`}>
                            <td className="px-4 py-2 font-semibold text-slate-800 dark:text-slate-100">{name}</td>
                            <td className={`px-4 py-2 font-mono ${(picksState?.lastWeeklyPoolDeltas?.[name] ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {(picksState?.lastWeeklyPoolDeltas?.[name] ?? 0) >= 0 ? '+' : ''}{picksState?.lastWeeklyPoolDeltas?.[name] ?? 0}$
                            </td>
                            <td className={`px-4 py-2 font-mono ${((seasonState.balances[name] ?? 0) + (picksState?.lastWeeklyPoolDeltas?.[name] ?? 0)) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {((seasonState.balances[name] ?? 0) + (picksState?.lastWeeklyPoolDeltas?.[name] ?? 0)) >= 0 ? '+' : ''}{(seasonState.balances[name] ?? 0) + (picksState?.lastWeeklyPoolDeltas?.[name] ?? 0)}$
                            </td>
                            <td className="px-4 py-2 text-slate-500 text-xs">
                              {formatLockRecord(seasonState.lockRecords[name] ?? { wins: 0, losses: 0, pushes: 0 })}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 w-full">
                {picksState && picksState.games.length > 0 && (
                  <button
                    onClick={() => setScreen('make')}
                    className="flex-1 py-3 rounded-xl text-sm font-bold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-white transition-colors"
                  >
                    {mySubmission ? 'Edit Picks' : 'Make Picks'}
                  </button>
                )}
                {picksState && picksState.submissions.length > 0 && (
                  <button
                    onClick={() => setScreen('view')}
                    className="flex-1 py-3 rounded-xl text-sm font-bold bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    View Picks
                  </button>
                )}
              </div>

              {admin && (
                <div className="w-full flex flex-col gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Admin</p>
                  {(rolloverPending || weekIssues.length > 0) && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3">
                      <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                        {rolloverPending ? 'Wednesday rollover is waiting for corrections' : 'Week completion checklist'}
                      </p>
                      <ul className="mt-1 max-h-28 overflow-auto text-[11px] text-amber-700 dark:text-amber-400 list-disc pl-4">
                        {weekIssues.slice(0, 12).map((issue, i) => <li key={`${issue.userName}-${issue.gameId}-${i}`}>{issue.message}</li>)}
                        {weekIssues.length > 12 && <li>{weekIssues.length - 12} more issues</li>}
                      </ul>
                    </div>
                  )}
                  <label className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>NFL slate to load</span>
                    <select
                      value={loadPreseason ? 'preseason-1' : String(nflWeek)}
                      onChange={e => {
                        if (e.target.value === 'preseason-1') setLoadPreseason(true);
                        else { setLoadPreseason(false); setNflWeek(Number(e.target.value)); }
                      }}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-slate-800 dark:text-slate-100 font-semibold"
                    >
                      <option value="preseason-1">Preseason Week 1</option>
                      {Array.from({ length: 20 }, (_, i) => i + 1).map(w => (
                        <option key={w} value={w}>{w === 19 ? 'Wild Card' : w === 20 ? 'Divisional' : `Week ${w}`}</option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={handleRefresh} disabled={loading} className="py-2 rounded-lg text-xs font-semibold text-amber-600 border border-amber-200 dark:border-amber-800 disabled:opacity-50">
                      ↻ Lines
                    </button>
                    <button onClick={handleScores} disabled={loading} className="py-2 rounded-lg text-xs font-semibold text-blue-600 border border-blue-200 dark:border-blue-800 disabled:opacity-50">
                      Scores
                    </button>
                    <button onClick={handleGrade} disabled={loading} className="py-2 rounded-lg text-xs font-semibold text-violet-600 border border-violet-200 dark:border-violet-800 disabled:opacity-50">
                      Grade
                    </button>
                    <button onClick={handleSeed} disabled={loading} className="py-2 rounded-lg text-xs font-semibold text-slate-500 border border-slate-200 dark:border-slate-700 disabled:opacity-50">
                      Test data
                    </button>
                  </div>
                  {picksState && picksState.games.length > 0 && (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                      <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Manual pick override</p>
                      <div className="grid grid-cols-2 gap-2">
                        <select value={editUser} onChange={e => setEditUser(e.target.value)} className="rounded-lg border p-2 text-xs bg-white dark:bg-slate-900">
                          {LEAGUE_MEMBERS.map(n => <option key={n}>{n}</option>)}
                        </select>
                        <select value={editGameId} onChange={e => { setEditGameId(e.target.value); setEditTeam(''); }} className="rounded-lg border p-2 text-xs bg-white dark:bg-slate-900">
                          <option value="">Select game</option>
                          {picksState.games.map(g => <option key={g.id} value={g.id}>{mascot(g.awayTeam)} @ {mascot(g.homeTeam)}</option>)}
                        </select>
                      </div>
                      <select value={editTeam} onChange={e => setEditTeam(e.target.value)} disabled={!editGameId} className="w-full rounded-lg border p-2 text-xs bg-white dark:bg-slate-900 disabled:opacity-50">
                        <option value="">Select pick</option>
                        {picksState.games.filter(g => g.id === editGameId).flatMap(g => [g.awayTeam, g.homeTeam]).map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={editAsLock} onChange={e => setEditAsLock(e.target.checked)} /> Set as Lock of the Week</label>
                      <input value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="Reason for correction (optional)" className="w-full rounded-lg border p-2 text-xs bg-white dark:bg-slate-900" />
                      <button onClick={handleManualEdit} disabled={loading || !editGameId || !editTeam} className="w-full py-2 rounded-lg text-xs font-semibold bg-slate-800 text-white disabled:opacity-40">Save override</button>
                      <button onClick={async () => { if (!editGameId) return; await apiAdminUnlockLine(myName, editGameId); await load(); setSuccess('Line unlocked.'); }} disabled={!editGameId} className="w-full py-2 rounded-lg text-xs font-semibold border border-amber-300 text-amber-700 disabled:opacity-40">Unlock selected game line</button>
                      {adminEdits.length > 0 && (
                        <details className="text-[11px] text-slate-500">
                          <summary className="cursor-pointer font-semibold">Correction log ({adminEdits.length})</summary>
                          <ul className="mt-1 space-y-1 max-h-28 overflow-auto">
                            {[...adminEdits].reverse().slice(0, 20).map(edit => (
                              <li key={edit.id}>{formatTs(edit.editedAt)} · {edit.timing?.replace('-', ' ') ?? 'timing unknown'} · {edit.userName}: {edit.previousTeam ?? 'missing'} → {edit.selectedTeam}{edit.setAsLock ? ' · Lock' : ''}{edit.reason ? ` · ${edit.reason}` : ''}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}
                  {picksState && picksState.submissions.length > 0 && (
                    confirmArchive ? (
                      <div className="flex gap-2">
                        <button onClick={handleArchive} className="flex-1 py-2 rounded-lg text-xs font-bold text-white bg-violet-600">Archive week</button>
                        <button onClick={() => setConfirmArchive(false)} className="flex-1 py-2 rounded-lg text-xs bg-slate-200 dark:bg-slate-700">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmArchive(true)} className="py-2 rounded-lg text-xs font-semibold text-violet-600 border border-violet-300 dark:border-violet-800 w-full">
                        Archive week → next
                      </button>
                    )
                  )}
                  {picksState && picksState.submissions.length > 0 && (
                    confirmClear ? (
                      <div className="flex gap-2">
                        <button onClick={handleClear} className="flex-1 py-2 rounded-lg text-xs font-bold text-white bg-red-600">Clear picks</button>
                        <button onClick={() => setConfirmClear(false)} className="flex-1 py-2 rounded-lg text-xs bg-slate-200 dark:bg-slate-700">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmClear(true)} className="py-2 rounded-lg text-xs font-semibold text-red-500 border border-red-200 dark:border-red-900 w-full">
                        Clear submissions only
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Make Picks ────────────────────────────────────────────────── */}
          {screen === 'make' && picksState && (
            <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full p-4 gap-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setScreen('home')} className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 text-sm">← Back</button>
                <h2 className="font-bold text-slate-900 dark:text-slate-100 text-base flex-1">
                  {mySubmission ? 'Edit Picks' : 'Make Picks'}
                </h2>
              </div>

              <p className="text-xs text-slate-500 -mt-2">
                Tap 🔒 Lock of the Week on one game after picking a side.
              </p>

              {allLocked && (
                <div className="bg-red-950/30 border border-red-800/40 rounded-xl px-4 py-3 text-center">
                  <p className="text-red-400 text-sm font-semibold">All picks locked for this week.</p>
                </div>
              )}

              <div className="space-y-3">
                {picksState.games.map(game => {
                  const selected  = draftPicks[game.id];
                  const locked    = now >= game.lockTime;
                  const isLock    = lockOfWeekGameId === game.id;

                  return (
                    <div
                      key={game.id}
                      className={`rounded-2xl border p-4 ${locked ? 'opacity-70 bg-slate-50 dark:bg-slate-900/40' : 'bg-white dark:bg-slate-900'}`}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <p className="text-xs text-slate-600 dark:text-slate-400">{gameTimeLabel(game)}</p>
                        {locked ? (
                          <span className="text-[10px] font-bold text-red-500 border border-red-500/20 px-2 py-0.5 rounded-full">LOCKED</span>
                        ) : (
                          <span className="text-[10px] text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-full border">Locks in {lockCountdown(game.lockTime, now)}</span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{matchupLine(game)}</p>
                      <div className="flex items-center gap-3 mt-1 mb-3">
                        <button
                          type="button"
                          onClick={() => setLineHistoryGame(game)}
                          className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                        >
                          Line history →
                        </button>
                        {game.lineLockedAt && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400">
                            Line locked after first pick
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {([game.awayTeam, game.homeTeam] as const).map(team => {
                          const isSelected = selected === team;
                          const logoUrl = espnTeamLogoUrl(team, picksState.sportKey);
                          return (
                            <button
                              key={team}
                              onClick={() => {
                                if (locked) return;
                                if (isSelected) {
                                  setDraftPicks(prev => {
                                    const next = { ...prev };
                                    delete next[game.id];
                                    return next;
                                  });
                                  if (lockOfWeekGameId === game.id) setLockOfWeekGameId(undefined);
                                } else {
                                  setDraftPicks(prev => ({ ...prev, [game.id]: team }));
                                }
                              }}
                              disabled={locked}
                              className={`flex flex-col items-center gap-2 rounded-xl py-4 px-2 disabled:cursor-not-allowed ${
                                isSelected ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 ring-2 ring-slate-900 dark:ring-white' : 'bg-slate-50 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                              }`}
                            >
                              {logoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={logoUrl} alt={team} width={64} height={64} className="w-16 h-16 object-contain" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                              ) : (
                                <span className="text-2xl font-black text-slate-400">{mascot(team).slice(0, 3)}</span>
                              )}
                              <span className="text-xs font-semibold">{mascot(team)}</span>
                            </button>
                          );
                        })}
                      </div>

                      {selected && !locked && (
                        <button
                          type="button"
                          onClick={() => setLockOfWeekGameId(game.id)}
                          className={`mt-3 w-full py-2 rounded-lg text-xs font-bold border transition-colors ${
                            isLock
                              ? 'bg-amber-500 text-white border-amber-600'
                              : 'bg-transparent text-amber-600 border-amber-300 dark:border-amber-800'
                          }`}
                        >
                          {isLock ? '🔒 Lock of the Week' : 'Set as Lock of the Week'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {!allLocked && (
                <button
                  onClick={handleSubmit}
                  disabled={(!Object.keys(draftPicks).length && !mySubmission) || loading}
                  className="py-3 rounded-xl text-sm font-bold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 disabled:opacity-40"
                >
                  {loading ? 'Saving…' : mySubmission ? 'Save Picks' : 'Save Picks'}
                </button>
              )}
            </div>
          )}

          {/* ── View (current week) ───────────────────────────────────────── */}
          {screen === 'view' && picksState && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                <button onClick={() => setScreen('home')} className="text-slate-500 text-sm">← Back</button>
                <h2 className="font-bold text-slate-900 dark:text-slate-100 text-base flex-1 truncate">
                  {picksState.weekLabel}
                </h2>
              </div>
              <PicksWeekTable
                weekLabel={picksState.weekLabel}
                games={picksState.games}
                submissions={picksState.submissions}
                myName={myName}
                poolDeltas={picksState.lastWeeklyPoolDeltas}
                showPool={Boolean(picksState.gradedAt)}
                footer={
                  !picksState.gradedAt && admin ? (
                    <p className="px-4 py-2 text-xs text-slate-500 text-center border-t border-slate-200 dark:border-slate-800">
                      Admin: fetch Scores, then Grade to show results.
                    </p>
                  ) : undefined
                }
              />
            </div>
          )}

          {/* ── Archived week view ────────────────────────────────────────── */}
          {screen === 'archiveView' && archivedWeek && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                <button
                  onClick={() => { setArchivedWeek(null); setScreen('history'); }}
                  className="text-slate-500 text-sm"
                >
                  ← History
                </button>
                <h2 className="font-bold text-slate-900 dark:text-slate-100 text-base flex-1 truncate">
                  {archivedWeek.weekLabel}
                </h2>
                <span className="text-[10px] text-slate-400">{archivedWeek.season}</span>
              </div>
              <PicksWeekTable
                weekLabel={archivedWeek.weekLabel}
                games={archivedWeek.games}
                submissions={archivedWeek.submissions}
                myName={myName}
                poolDeltas={archivedWeek.weeklyPoolDeltas}
                showPool
                balancesAfterWeek={archivedWeek.balancesAfterWeek}
              />
              {admin && (
                <div className="p-3 border-t flex flex-wrap gap-2 bg-white dark:bg-slate-900">
                  <select value={editUser} onChange={e => setEditUser(e.target.value)} className="border rounded p-2 text-xs bg-inherit">{LEAGUE_MEMBERS.map(n => <option key={n}>{n}</option>)}</select>
                  <select value={editGameId} onChange={e => { setEditGameId(e.target.value); setEditTeam(''); }} className="border rounded p-2 text-xs bg-inherit"><option value="">Game</option>{archivedWeek.games.map(g => <option key={g.id} value={g.id}>{mascot(g.awayTeam)} @ {mascot(g.homeTeam)}</option>)}</select>
                  <select value={editTeam} onChange={e => setEditTeam(e.target.value)} className="border rounded p-2 text-xs bg-inherit"><option value="">Pick</option>{archivedWeek.games.filter(g => g.id === editGameId).flatMap(g => [g.awayTeam, g.homeTeam]).map(t => <option key={t}>{t}</option>)}</select>
                  <button disabled={!editGameId || !editTeam} onClick={async () => { try { const week = await apiEditArchive(myName, archivedWeek.id, editUser, editGameId, editTeam); setArchivedWeek(week); await load(); setSuccess('Archived week corrected and season recalculated.'); } catch (e) { setError(e instanceof Error ? e.message : 'Edit failed'); } }} className="bg-slate-800 text-white rounded px-3 text-xs disabled:opacity-40">Correct archived pick</button>
                </div>
              )}
            </div>
          )}

          {/* ── History ───────────────────────────────────────────────────── */}
          {screen === 'history' && (
            <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full p-4 gap-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setScreen('home')} className="text-slate-500 text-sm">← Home</button>
                <h2 className="font-bold text-slate-900 dark:text-slate-100">Season archive</h2>
              </div>

              {history.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-8">No archived weeks yet.</p>
              ) : (
                <ul className="space-y-2">
                  {history.map(week => (
                    <li key={week.id}>
                      <button
                        type="button"
                        onClick={() => { setArchivedWeek(week); setScreen('archiveView'); }}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/80 text-left transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">
                            {week.weekLabel}
                          </p>
                          <p className="text-xs text-slate-500">
                            {week.season} · archived {formatTs(week.archivedAt)}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-slate-500">View →</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

        </div>
      </div>

      {lineHistoryGame && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4"
          onClick={() => setLineHistoryGame(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="line-history-title"
          >
            <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex-1 min-w-0">
                <p id="line-history-title" className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  Line history
                </p>
                <p className="text-xs text-slate-500 mt-0.5 truncate">{matchupLine(lineHistoryGame)}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{gameTimeLabel(lineHistoryGame)}</p>
              </div>
              <button
                type="button"
                onClick={() => setLineHistoryGame(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-lg leading-none px-1"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="max-h-[60vh] overflow-auto px-4 py-3">
              {(!lineHistoryGame.lineHistory || lineHistoryGame.lineHistory.length === 0) ? (
                <div className="text-center py-6 space-y-1">
                  <p className="text-sm text-slate-500">No recorded moves yet.</p>
                  <p className="text-xs text-slate-400">
                    Current line: home {formatHomeSpread(lineHistoryGame.homeSpread)}
                  </p>
                </div>
              ) : (
                <ol className="space-y-3">
                  {[...lineHistoryGame.lineHistory].reverse().map((entry, idx, arr) => {
                    const prev = arr[idx + 1];
                    const changed =
                      prev &&
                      prev.homeSpread !== entry.homeSpread;
                    return (
                      <li
                        key={`${entry.at}-${entry.source}-${idx}`}
                        className="flex gap-3"
                      >
                        <div className="flex flex-col items-center pt-1">
                          <span className={`w-2 h-2 rounded-full ${idx === 0 ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                          {idx < arr.length - 1 && <span className="w-px flex-1 bg-slate-200 dark:bg-slate-700 mt-1" />}
                        </div>
                        <div className="flex-1 pb-2">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              Home {formatHomeSpread(entry.homeSpread)}
                            </p>
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              {lineHistorySourceLabel(entry.source)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{formatTs(entry.at)}</p>
                          {changed && prev && (
                            <p className="text-[11px] text-slate-400 mt-1">
                              Moved from {formatHomeSpread(prev.homeSpread)}
                              {prev.homeSpread != null && entry.homeSpread != null && (
                                <span>
                                  {' '}({entry.homeSpread - prev.homeSpread > 0 ? '+' : ''}
                                  {(entry.homeSpread - prev.homeSpread).toFixed(
                                    Number.isInteger(entry.homeSpread - prev.homeSpread) ? 0 : 1,
                                  )})
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>

            <p className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400">
              Spreads shown as home team line (negative = home favored).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
