'use client';

import { useState, useEffect, useCallback } from 'react';
import { lockCountdown } from '@/lib/picks-utils';
import type { PicksState, NFLGame, WeeklyPick, UserPicksSubmission } from '@/lib/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HARDCODED_ADMINS = new Set(['jon']);

function isPicksAdmin(name: string): boolean {
  return HARDCODED_ADMINS.has(name.toLowerCase());
}

/** "Dallas Cowboys" → "Cowboys" */
function mascot(fullName: string): string {
  const parts = fullName.trim().split(' ');
  return parts[parts.length - 1];
}

/** "Dallas Cowboys" → "Dallas" / "Kansas City Chiefs" → "Kansas City" */
function city(fullName: string): string {
  const parts = fullName.trim().split(' ');
  return parts.slice(0, -1).join(' ');
}

/**
 * "City at City (line)" where the line always appears next to the favored team.
 *   homeSpread = -8.5  →  "Dallas at Philadelphia (-8.5)"
 *   homeSpread = +3    →  "Kansas City (-3) at Los Angeles"
 *   homeSpread = 0     →  "Dallas at Philadelphia (PK)"
 */
function matchupLine(game: NFLGame): string {
  const away = city(game.awayTeam);
  const home = city(game.homeTeam);
  const hs   = game.homeSpread;
  if (hs === null) return `${away} at ${home}`;
  if (hs === 0)    return `${away} at ${home} (PK)`;
  if (hs < 0)      return `${away} at ${home} (${hs})`;      // home favored
  return `${away} (${-hs}) at ${home}`;                       // away favored
}

function gameColumnDay(game: NFLGame): string {
  return new Date(game.commenceTime).toLocaleDateString('en-US', {
    weekday: 'long', timeZone: 'America/New_York',
  });
}

/** Full string used in exports / aria labels */
function gameColumnHeader(game: NFLGame): string {
  return `${gameColumnDay(game)} - ${matchupLine(game)}`;
}

// ─── ESPN team logo helpers ───────────────────────────────────────────────────

const NFL_ESPN_ABBR: Record<string, string> = {
  'Arizona Cardinals':    'ari', 'Atlanta Falcons':      'atl',
  'Baltimore Ravens':     'bal', 'Buffalo Bills':        'buf',
  'Carolina Panthers':    'car', 'Chicago Bears':        'chi',
  'Cincinnati Bengals':   'cin', 'Cleveland Browns':     'cle',
  'Dallas Cowboys':       'dal', 'Denver Broncos':       'den',
  'Detroit Lions':        'det', 'Green Bay Packers':    'gb',
  'Houston Texans':       'hou', 'Indianapolis Colts':   'ind',
  'Jacksonville Jaguars': 'jax', 'Kansas City Chiefs':   'kc',
  'Las Vegas Raiders':    'lv',  'Los Angeles Chargers': 'lac',
  'Los Angeles Rams':     'lar', 'Miami Dolphins':       'mia',
  'Minnesota Vikings':    'min', 'New England Patriots': 'ne',
  'New Orleans Saints':   'no',  'New York Giants':      'nyg',
  'New York Jets':        'nyj', 'Philadelphia Eagles':  'phi',
  'Pittsburgh Steelers':  'pit', 'San Francisco 49ers':  'sf',
  'Seattle Seahawks':     'sea', 'Tampa Bay Buccaneers': 'tb',
  'Tennessee Titans':     'ten', 'Washington Commanders': 'wsh',
};

function espnLogoUrl(fullName: string): string {
  const abbr = NFL_ESPN_ABBR[fullName];
  return abbr ? `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr}.png` : '';
}

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

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetchPicks(): Promise<PicksState | null> {
  const res  = await fetch('/api/picks');
  const data = await res.json();
  return data.state ?? null;
}

async function apiSubmitPicks(userName: string, picks: WeeklyPick[]): Promise<PicksState> {
  const res  = await fetch('/api/picks', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ userName, picks }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Submit failed');
  return data.state;
}

async function apiRefreshGames(): Promise<PicksState> {
  const res  = await fetch('/api/picks/refresh', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Refresh failed');
  return data.state;
}

async function apiClearPicks(): Promise<PicksState | null> {
  const res  = await fetch('/api/picks', { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Clear failed');
  return data.state ?? null;
}

async function apiSeedGames(): Promise<PicksState> {
  const res  = await fetch('/api/picks/seed', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Seed failed');
  return data.state;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen = 'home' | 'make' | 'view';

// ─── PicksBoard ───────────────────────────────────────────────────────────────

export default function PicksBoard({
  myName, dark, onLeave,
}: {
  myName: string;
  dark:   boolean;
  onLeave: () => void;
}) {
  const admin = isPicksAdmin(myName);

  const [screen,       setScreen]      = useState<Screen>('home');
  const [picksState,   setPicksState]  = useState<PicksState | null>(null);
  const [draftPicks,   setDraftPicks]  = useState<Record<string, string>>({}); // gameId → team
  const [loading,      setLoading]     = useState(false);
  const [error,        setError]       = useState<string | null>(null);
  const [success,      setSuccess]     = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [now,          setNow]         = useState(() => Date.now());

  // Tick every 30 s to refresh lock countdowns
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Load on mount ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const state = await apiFetchPicks();
      setPicksState(state);
      // Pre-fill draft picks from any existing submission
      if (state) {
        const mine = state.submissions.find(s => s.userName === myName);
        if (mine) {
          const map: Record<string, string> = {};
          mine.picks.forEach(p => { map[p.gameId] = p.selectedTeam; });
          setDraftPicks(map);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [myName]);

  useEffect(() => { load(); }, [load]);

  // ── Submit picks ──────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!picksState) return;
    const unlockedGames = picksState.games.filter(g => now < g.lockTime);
    const missingPick   = unlockedGames.find(g => !draftPicks[g.id]);
    if (missingPick) {
      setError(`Please pick a team for every unlocked game.`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Send all current draftPicks; server will preserve locked picks from existing submission
      const picks: WeeklyPick[] = Object.entries(draftPicks).map(([gameId, selectedTeam]) => ({
        gameId, selectedTeam,
      }));
      const next = await apiSubmitPicks(myName, picks);
      setPicksState(next);
      setSuccess('Picks submitted!');
      setScreen('view');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Admin: refresh games ──────────────────────────────────────────────────

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await apiRefreshGames();
      setPicksState(next);
      setSuccess(`Games refreshed — ${next.games.length} game${next.games.length !== 1 ? 's' : ''} loaded.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Admin: clear submissions ──────────────────────────────────────────────

  const handleClear = async () => {
    setConfirmClear(false);
    setLoading(true);
    setError(null);
    try {
      const next = await apiClearPicks();
      setPicksState(next);
      setDraftPicks({});
      setSuccess('All picks cleared for the new week.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clear failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Admin: seed test games ────────────────────────────────────────────────

  const handleSeed = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await apiSeedGames();
      setPicksState(next);
      setDraftPicks({});
      setSuccess('Test games loaded — 5 fake matchups ready.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seed failed');
    } finally {
      setLoading(false);
    }
  };

  const mySubmission: UserPicksSubmission | undefined =
    picksState?.submissions.find(s => s.userName === myName);

  const unlockedGames   = picksState?.games.filter(g => now < g.lockTime) ?? [];
  const lockedGames     = picksState?.games.filter(g => now >= g.lockTime) ?? [];
  const allUnlockedPicked = unlockedGames.every(g => draftPicks[g.id]);
  const allLocked         = picksState ? lockedGames.length === picksState.games.length : false;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="min-h-screen flex flex-col bg-slate-100 dark:bg-slate-950">

        {/* Nav */}
        <nav className="shrink-0 bg-slate-900 flex items-center gap-3 px-4 py-2.5">
          <button onClick={onLeave} className="text-slate-400 hover:text-white text-xs transition-colors">← Back</button>
          <div className="w-px h-4 bg-slate-700" />
          <span className="font-bold text-sm text-white tracking-tight">4Man Drafting Portal</span>
          <span className="text-slate-500 text-xs">·</span>
          <span className="text-slate-400 text-xs">Weekly Picks</span>
          {picksState && (
            <>
              <span className="text-slate-500 text-xs">·</span>
              <span className="text-slate-300 text-xs font-medium">{picksState.weekLabel}</span>
            </>
          )}
          <div className="flex-1" />
          <span className="text-xs text-slate-300 font-medium">{myName}</span>
          {admin && <span className="text-[10px] text-amber-500 bg-amber-950/40 px-1.5 py-0.5 rounded font-semibold">admin</span>}
        </nav>

        {/* Error / Success banners */}
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

        {/* Body */}
        <div className="flex-1 flex flex-col">

          {/* ── Home ──────────────────────────────────────────────────────── */}
          {screen === 'home' && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
              {loading && (
                <p className="text-slate-400 text-sm animate-pulse">Loading…</p>
              )}

              {!loading && !picksState && (
                <div className="text-center space-y-2">
                  <p className="text-slate-400 text-sm">No games loaded yet.</p>
                  {admin && (
                    <p className="text-slate-500 text-xs">Use the button below to fetch this week's DraftKings lines.</p>
                  )}
                </div>
              )}

              {!loading && picksState && (
                <div className="text-center space-y-1">
                  <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100">{picksState.weekLabel}</h2>
                  <p className="text-slate-500 dark:text-slate-400 text-sm">
                    {picksState.games.length} game{picksState.games.length !== 1 ? 's' : ''} ·{' '}
                    {picksState.submissions.length} / 4 submitted
                  </p>
                  {mySubmission && (
                    <p className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                      ✓ You submitted · {formatTs(mySubmission.updatedAt)}
                    </p>
                  )}
                  {lockedGames.length > 0 && lockedGames.length < (picksState?.games.length ?? 0) && (
                    <p className="text-amber-500 dark:text-amber-400 text-xs">
                      ⚠ {lockedGames.length} game{lockedGames.length !== 1 ? 's' : ''} locked · {unlockedGames.length} still open
                    </p>
                  )}
                  {allLocked && (
                    <p className="text-red-500 text-xs font-semibold">All picks locked for this week.</p>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
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
                    View All Picks
                  </button>
                )}
              </div>

              {/* Admin controls */}
              {admin && (
                <div className="flex flex-col sm:flex-row gap-2 w-full max-w-sm pt-2 border-t border-slate-200 dark:border-slate-800">
                  <button
                    onClick={handleRefresh}
                    disabled={loading}
                    className="flex-1 py-2 rounded-lg text-xs font-semibold text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors disabled:opacity-50"
                  >
                    ↻ Refresh DraftKings Lines
                  </button>
                  <button
                    onClick={handleSeed}
                    disabled={loading}
                    className="flex-1 py-2 rounded-lg text-xs font-semibold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                  >
                    🧪 Load Test Data
                  </button>
                  {picksState && picksState.submissions.length > 0 && (
                    confirmClear ? (
                      <div className="flex gap-2 flex-1">
                        <button onClick={handleClear} className="flex-1 py-2 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 transition-colors">Confirm Clear</button>
                        <button onClick={() => setConfirmClear(false)} className="flex-1 py-2 rounded-lg text-xs font-semibold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmClear(true)} className="flex-1 py-2 rounded-lg text-xs font-semibold text-red-500 border border-red-200 dark:border-red-900 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
                        Clear All Picks
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
                <button onClick={() => setScreen('home')} className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 text-sm transition-colors">← Back</button>
                <h2 className="font-bold text-slate-900 dark:text-slate-100 text-base flex-1">
                  {mySubmission ? 'Edit Your Picks' : 'Make Your Picks'}
                </h2>
                <span className="text-xs text-slate-400">
                  {Object.keys(draftPicks).length} / {picksState.games.length} picked
                </span>
              </div>

              {allLocked && (
                <div className="bg-red-950/30 border border-red-800/40 rounded-xl px-4 py-3 text-center">
                  <p className="text-red-400 text-sm font-semibold">All picks are locked for this week.</p>
                </div>
              )}

              <div className="space-y-3">
                {picksState.games.map(game => {
                  const selected   = draftPicks[game.id];
                  const locked     = now >= game.lockTime;
                  const countdown  = lockCountdown(game.lockTime, now);

                  return (
                    <div
                      key={game.id}
                      className={`rounded-2xl border p-4 transition-colors ${
                        locked
                          ? 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800/60 opacity-70'
                          : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'
                      }`}
                    >
                      {/* Game header */}
                      <div className="flex items-start justify-between mb-1">
                        <p className="text-xs text-slate-400 dark:text-slate-500">{gameTimeLabel(game)}</p>
                        {locked ? (
                          <span className="text-[10px] font-bold text-red-500 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full shrink-0">
                            LOCKED
                          </span>
                        ) : (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                            game.lockTime - now < 3_600_000
                              ? 'text-amber-500 bg-amber-500/10 border border-amber-500/20'
                              : 'text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700'
                          }`}>
                            Locks in {countdown}
                          </span>
                        )}
                      </div>

                      {/* Matchup line with spread next to favored team */}
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-4">
                        {matchupLine(game)}
                      </p>

                      {/* Logo pick buttons */}
                      <div className="grid grid-cols-2 gap-3">
                        {([game.awayTeam, game.homeTeam] as const).map(team => {
                          const isSelected = selected === team;
                          const logoUrl    = espnLogoUrl(team);
                          return (
                            <button
                              key={team}
                              onClick={() => !locked && setDraftPicks(prev => ({ ...prev, [game.id]: team }))}
                              disabled={locked}
                              className={`relative flex flex-col items-center gap-2 rounded-xl py-4 px-2 transition-all disabled:cursor-not-allowed ${
                                isSelected
                                  ? locked
                                    ? 'bg-slate-700/60 ring-2 ring-slate-500'
                                    : 'bg-slate-900 dark:bg-white ring-2 ring-slate-900 dark:ring-white shadow-lg scale-[1.03]'
                                  : locked
                                    ? 'bg-slate-100 dark:bg-slate-800/40'
                                    : 'bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700'
                              }`}
                            >
                              {/* Selected checkmark */}
                              {isSelected && !locked && (
                                <span className="absolute top-2 right-2 text-[10px] text-white dark:text-slate-900 font-black">✓</span>
                              )}
                              {/* Logo */}
                              {logoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={logoUrl}
                                  alt={team}
                                  width={64}
                                  height={64}
                                  className={`w-16 h-16 object-contain transition-all ${
                                    locked && !isSelected ? 'opacity-30 grayscale' : isSelected && !locked ? 'brightness-0 invert dark:brightness-100 dark:invert-0' : ''
                                  }`}
                                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                />
                              ) : (
                                <span className={`text-2xl font-black ${isSelected && !locked ? 'text-white dark:text-slate-900' : 'text-slate-400'}`}>
                                  {mascot(team).slice(0, 3).toUpperCase()}
                                </span>
                              )}
                              {/* Team name */}
                              <span className={`text-xs font-semibold leading-tight text-center ${
                                isSelected && !locked
                                  ? 'text-white dark:text-slate-900'
                                  : locked
                                    ? 'text-slate-400 dark:text-slate-600'
                                    : 'text-slate-600 dark:text-slate-300'
                              }`}>
                                {mascot(team)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {!allLocked && (
                <button
                  onClick={handleSubmit}
                  disabled={!allUnlockedPicked || loading}
                  className="py-3 rounded-xl text-sm font-bold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading
                    ? 'Submitting…'
                    : mySubmission
                      ? `Update ${unlockedGames.length} Unlocked Pick${unlockedGames.length !== 1 ? 's' : ''}`
                      : 'Submit Picks'}
                </button>
              )}
            </div>
          )}

          {/* ── View All Picks ────────────────────────────────────────────── */}
          {screen === 'view' && picksState && (
            <div className="flex-1 flex flex-col">
              <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                <button onClick={() => setScreen('home')} className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 text-sm transition-colors">← Back</button>
                <h2 className="font-bold text-slate-900 dark:text-slate-100 text-base flex-1">All Picks — {picksState.weekLabel}</h2>
                <span className="text-xs text-slate-400">{picksState.submissions.length} submitted</span>
              </div>

              {picksState.submissions.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-slate-400 dark:text-slate-600 text-sm">No picks submitted yet.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-auto">
                  <table className="min-w-max text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-800 text-white text-left sticky top-0 z-10">
                        <th className="px-4 py-3 font-semibold text-xs whitespace-nowrap sticky left-0 bg-slate-800 z-20">Timestamp</th>
                        <th className="px-4 py-3 font-semibold text-xs whitespace-nowrap sticky left-28 bg-slate-800 z-20 border-r border-slate-700">Name</th>
                        {picksState.games.map(game => (
                          <th
                            key={game.id}
                            aria-label={gameColumnHeader(game)}
                            className="px-4 py-3 text-left align-bottom"
                            style={{ minWidth: '160px' }}
                          >
                            <span className="block text-[10px] font-normal text-slate-400 whitespace-nowrap mb-0.5">
                              {gameColumnDay(game)}
                            </span>
                            <span className="block text-xs font-semibold text-white whitespace-nowrap">
                              {matchupLine(game)}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {picksState.submissions.map((sub, i) => {
                        const pickMap: Record<string, string> = {};
                        sub.picks.forEach(p => { pickMap[p.gameId] = p.selectedTeam; });
                        return (
                          <tr
                            key={sub.userName}
                            className={`border-b border-slate-100 dark:border-slate-800 ${
                              i % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50 dark:bg-slate-900/50'
                            } ${sub.userName === myName ? 'ring-1 ring-inset ring-amber-400' : ''}`}
                          >
                            <td className="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap sticky left-0 bg-inherit">
                              {formatTs(sub.submittedAt)}
                            </td>
                            <td className="px-4 py-2.5 font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap sticky left-28 bg-inherit border-r border-slate-100 dark:border-slate-800">
                              {sub.userName}
                              {sub.userName === myName && <span className="ml-1 text-[10px] text-amber-500">★</span>}
                            </td>
                            {picksState.games.map(game => {
                              const picked = pickMap[game.id];
                              return (
                                <td key={game.id} className="px-4 py-2.5 whitespace-nowrap text-slate-700 dark:text-slate-300">
                                  {picked ? mascot(picked) : <span className="text-slate-300 dark:text-slate-600">–</span>}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
