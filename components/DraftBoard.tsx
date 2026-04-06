'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Image from 'next/image';
import PicksBoard from './PicksBoard';
import type { Player, DraftedPlayer, DraftState, ArchivedDraft } from '@/lib/types';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// ── League roster — edit here to add/remove people ───────────────────────────
// Names are canonical (display) form. Comparison is always case-insensitive.
const HARDCODED_MANAGERS: string[] = ['Charlie', 'Jon', 'Steven', 'Avery'];
const HARDCODED_MEMBERS  = new Set(HARDCODED_MANAGERS.map(n => n.toLowerCase()));
const HARDCODED_ADMINS   = new Set(['jon']); // always have admin powers

const COLORS = [
  { header: 'bg-rose-500',    cell: 'bg-rose-50    dark:bg-rose-950/40',    border: 'border-rose-300',    text: 'text-rose-500',    },
  { header: 'bg-emerald-500', cell: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-300', text: 'text-emerald-500', },
  { header: 'bg-amber-500',   cell: 'bg-amber-50   dark:bg-amber-950/40',   border: 'border-amber-300',   text: 'text-amber-500',   },
  { header: 'bg-sky-500',     cell: 'bg-sky-50     dark:bg-sky-950/40',     border: 'border-sky-300',     text: 'text-sky-500',     },
  { header: 'bg-violet-500',  cell: 'bg-violet-50  dark:bg-violet-950/40',  border: 'border-violet-300',  text: 'text-violet-500',  },
  { header: 'bg-pink-500',    cell: 'bg-pink-50    dark:bg-pink-950/40',    border: 'border-pink-300',    text: 'text-pink-500',    },
  { header: 'bg-teal-500',    cell: 'bg-teal-50    dark:bg-teal-950/40',    border: 'border-teal-300',    text: 'text-teal-500',    },
  { header: 'bg-orange-500',  cell: 'bg-orange-50  dark:bg-orange-950/40',  border: 'border-orange-300',  text: 'text-orange-500',  },
] as const;

type ColorScheme = { header: string; cell: string; border: string; text: string };

// Each league member always gets the same color regardless of draft order position.
const NAME_COLORS: Record<string, ColorScheme> = {
  Jon:     { header: 'bg-emerald-500', cell: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-300', text: 'text-emerald-500' },
  Charlie: { header: 'bg-blue-500',    cell: 'bg-blue-50    dark:bg-blue-950/40',    border: 'border-blue-300',    text: 'text-blue-500'    },
  Steven:  { header: 'bg-amber-500',   cell: 'bg-amber-50   dark:bg-amber-950/40',   border: 'border-amber-300',   text: 'text-amber-500'   },
  Avery:   { header: 'bg-rose-500',    cell: 'bg-rose-50    dark:bg-rose-950/40',    border: 'border-rose-300',    text: 'text-rose-500'    },
};

function colorFor(name: string, fallbackIdx = 0): ColorScheme {
  return NAME_COLORS[name] ?? COLORS[fallbackIdx % COLORS.length];
}

const POS_COLORS: Record<string, string> = {
  QB: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
  RB: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  WR: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300',
  TE: 'bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300',
};

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE'] as const;
type PosFilter = (typeof POSITIONS)[number];

const NAME_KEY        = 'fantasy-draft-name';
const DARK_MODE_KEY   = 'fantasy-draft-dark';
const POLL_MS          = 3_000;   // draft state sync
const HEARTBEAT_MS     = 15_000;  // presence ping
const PRESENCE_POLL_MS = 15_000;  // presence refresh

interface PresenceUser { name: string; lastSeenAt: number; }

// ─────────────────────────────────────────────────────────────────────────────
// Draft math — all functions take n (team count) and snake flag explicitly
// ─────────────────────────────────────────────────────────────────────────────

function slotForPick(pick: number, n: number, snake = true): number {
  const zero  = pick - 1;
  const round = Math.floor(zero / n);
  const pos   = zero % n;
  return snake && round % 2 !== 0 ? n - 1 - pos : pos;
}

function pickNum(m: number, r: number, n: number, snake = true): number {
  if (!snake) return (r - 1) * n + m + 1;
  return r % 2 === 1 ? (r - 1) * n + m + 1 : r * n - m;
}

function roundForPick(pick: number, n: number): number {
  return Math.ceil(pick / n);
}

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

async function apiFetchDraft(): Promise<{ state: DraftState | null; localMode: boolean }> {
  const res = await fetch('/api/draft');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiStartDraft(managers: string[], rounds: number, adminName: string, snakeDraft: boolean, draftName: string): Promise<DraftState> {
  const res = await fetch('/api/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ managers, rounds, adminName, snakeDraft, draftName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to start draft');
  return data.state;
}

async function apiUpdateSettings(updates: Partial<DraftState>): Promise<DraftState> {
  const res = await fetch('/api/draft', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to save settings');
  return data.state;
}

async function apiResetDraft(): Promise<void> {
  await fetch('/api/draft', { method: 'DELETE' });
}

async function apiPick(player: Player, managerName: string): Promise<DraftState> {
  const res = await fetch('/api/draft/pick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player, managerName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Pick failed');
  return data.state;
}

async function apiUndo(): Promise<DraftState> {
  const res = await fetch('/api/draft/undo', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Undo failed');
  return data.state;
}

async function loadPlayers(): Promise<{ players: Player[]; updatedAt: number | null }> {
  const res = await fetch('/api/players');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  if (d.error) throw new Error(d.error);
  return { players: d.players, updatedAt: d.updatedAt ?? null };
}

async function refreshPlayers(): Promise<void> {
  await fetch('/api/players/refresh');
}

function timeAgo(ts: number | null): string {
  if (!ts) return 'unknown';
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function SunIcon()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>; }
function MoonIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>; }
function GearIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>; }

// ─────────────────────────────────────────────────────────────────────────────
// Shared micro-components
// ─────────────────────────────────────────────────────────────────────────────

function PosBadge({ pos }: { pos: string }) {
  return (
    <span className={`inline-block px-1.5 py-px rounded-md text-[10px] font-bold leading-tight ${POS_COLORS[pos] ?? 'bg-gray-100 text-gray-600'}`}>
      {pos}
    </span>
  );
}

function PlayerPhoto({ playerId, team, size }: { playerId: string; team: string; size: 28 | 36 | 44 }) {
  const [err, setErr] = useState(false);
  return (
    <div className="relative shrink-0 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-700 ring-1 ring-slate-200 dark:ring-slate-600" style={{ width: size, height: size }}>
      <Image
        src={err ? `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.jpg`
                 : `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`}
        alt="" fill
        className={err ? 'object-contain p-0.5' : 'object-cover object-top'}
        onError={() => setErr(true)}
        unoptimized
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirm modal
// ─────────────────────────────────────────────────────────────────────────────

interface ConfirmProps {
  title:         string;
  message:       string;
  confirmLabel?: string;
  danger?:       boolean;
  onConfirm:     () => void;
  onCancel:      () => void;
}

function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }: ConfirmProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-2xl shadow-black/30 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">{message}</p>
        </div>
        <div className="flex gap-2 px-6 pb-6">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} className={`flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-colors ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-white'}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings modal (admin only)
// ─────────────────────────────────────────────────────────────────────────────

function SettingsModal({ state, onSave, onClose }: {
  state:   DraftState;
  onSave:  (updates: Partial<DraftState>) => Promise<void>;
  onClose: () => void;
}) {
  const locked = state.picks.length > 0;
  const [order,  setOrder]  = useState<string[]>(state.managers);
  const [rounds, setRounds] = useState<number>(state.rounds);
  const [snake,  setSnake]  = useState<boolean>(state.snakeDraft !== false);
  const [admin,  setAdmin]  = useState<string>(state.adminName ?? '');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    setOrder(prev => { const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next; });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updates: Partial<DraftState> = {
        rounds,
        snakeDraft: snake,
        adminName: admin.trim() || undefined,
        ...(!locked ? { managers: order } : {}),
      };
      await onSave(updates);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Draft Settings</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Draft order */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Draft Order</p>
              {locked && (
                <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 rounded-full font-semibold">
                  🔒 Locked after first pick
                </span>
              )}
            </div>
            <div className="space-y-2">
              {order.map((name, i) => {
                const colorIdx = HARDCODED_MANAGERS.findIndex(m => m === name);
                return (
                  <div key={name} className="flex items-center gap-2.5 bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5">
                    <span className="text-xs font-bold text-slate-400 w-4 text-center shrink-0">{i + 1}</span>
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorFor(name).header}`} />
                    <span className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{name}</span>
                    <div className="flex gap-1 shrink-0">
                      <button type="button" onClick={() => move(i, -1)} disabled={locked || i === 0}
                        className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 disabled:opacity-20 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-xs font-bold">↑</button>
                      <button type="button" onClick={() => move(i, 1)} disabled={locked || i === order.length - 1}
                        className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 disabled:opacity-20 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-xs font-bold">↓</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Format */}
          <section>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Draft Format</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Rounds</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{rounds * order.length} total picks</p>
                </div>
                <select value={rounds} onChange={e => setRounds(Number(e.target.value))}
                  className="bg-slate-100 dark:bg-slate-600 border-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:outline-none">
                  {[8, 10, 12, 14, 15, 16, 17, 18, 20].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Draft type</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {snake ? 'Snake — order reverses each round' : 'Linear — same order every round'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${!snake ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400'}`}>Linear</span>
                  <button type="button" onClick={() => !locked && setSnake(s => !s)} disabled={locked}
                    className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-40 ${snake ? 'bg-slate-800 dark:bg-slate-200' : 'bg-slate-300 dark:bg-slate-600'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white dark:bg-slate-800 shadow transition-transform ${snake ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                  <span className={`text-xs font-semibold ${snake ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400'}`}>Snake</span>
                </div>
              </div>
            </div>
          </section>

          {/* Access */}
          <section>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Access</p>
            <div className="space-y-3">
              <div className="bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Extra admin name</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">Can draft on behalf of any team</p>
                <input type="text" value={admin} onChange={e => setAdmin(e.target.value)} placeholder="Name of additional admin"
                  className="w-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-500" />
              </div>
              <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
                <span className="text-amber-500 text-sm">★</span>
                <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                  <strong>Jon</strong> always has admin privileges (hardcoded)
                </p>
              </div>
            </div>
          </section>

          {error && <p className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm rounded-xl px-4 py-3">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 py-4 border-t border-slate-100 dark:border-slate-700">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-white disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Login screen
// ─────────────────────────────────────────────────────────────────────────────

function LoginScreen({ onLogin, loading, error }: {
  onLogin: (name: string) => void;
  loading: boolean;
  error:   string | null;
}) {
  const [name, setName] = useState('');
  const submit = () => { if (name.trim()) onLogin(name.trim()); };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff06_1px,transparent_1px),linear-gradient(to_bottom,#ffffff06_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none" />
      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-white tracking-tight">4man Portal</h1>
          <p className="text-slate-500 text-sm mt-1">Enter your name to login</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl shadow-black/40 p-6 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">Your name</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              placeholder="Your name"
              className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-500"
            />
          </div>
          {error && (
            <p className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm rounded-lg px-4 py-2.5">
              {error}
            </p>
          )}
          <button
            onClick={submit}
            disabled={!name.trim() || loading}
            className="w-full bg-slate-900 dark:bg-slate-100 hover:bg-slate-700 dark:hover:bg-white disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white dark:text-slate-900 font-bold py-3 rounded-xl transition-colors text-sm"
          >
            {loading ? 'Logging in…' : 'Login →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lobby — Presence / waiting tab (all users)
// ─────────────────────────────────────────────────────────────────────────────

function LobbyTab({ myName, presence }: { myName: string; presence: PresenceUser[] }) {
  return (
    <div className="space-y-4">
      <div className="bg-white/5 border border-white/10 rounded-2xl px-5 py-4">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
          Online now
          {presence.length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] font-bold">
              {presence.length}
            </span>
          )}
        </p>
        {presence.length === 0 ? (
          <p className="text-sm text-slate-600">No one else online yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {presence.map(u => {
              const secsAgo = Math.round((Date.now() - u.lastSeenAt) / 1000);
              const isMe    = u.name === myName;
              return (
                <div key={u.name} className="flex items-center gap-2.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${secsAgo < 12 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className={`text-sm font-semibold ${isMe ? 'text-slate-400 italic' : 'text-slate-200'}`}>
                    {u.name}{isMe ? ' (you)' : ''}
                  </span>
                  <span className="ml-auto text-xs text-slate-500 tabular-nums">
                    {secsAgo < 5 ? 'just now' : `${secsAgo}s ago`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="text-center text-xs text-slate-600">Waiting for an admin to start the draft…</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lobby — Admin setup tab (admin only)
// ─────────────────────────────────────────────────────────────────────────────

function AdminSetupTab({ onStart, onRefreshPlayers, loading, refreshing, error, playerUpdatedAt }: {
  onStart:          (names: string[], rounds: number, adminName: string, snakeDraft: boolean, draftName: string) => void;
  onRefreshPlayers: () => void;
  loading:          boolean;
  refreshing:       boolean;
  error:            string | null;
  playerUpdatedAt:  number | null;
}) {
  // Order is the only editable thing — names are fixed
  const [order,     setOrder]     = useState<string[]>([...HARDCODED_MANAGERS]);
  const [rounds,    setRounds]    = useState(18);
  const [snake,     setSnake]     = useState(true);
  const [admin,     setAdmin]     = useState('');
  const [draftName, setDraftName] = useState('');

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    setOrder(prev => { const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next; });
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl shadow-black/40 p-6 space-y-5">

      {/* Draft order */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Draft order</p>
        <div className="space-y-2">
          {order.map((name, i) => {
            const colorIdx = HARDCODED_MANAGERS.findIndex(m => m === name);
            return (
              <div key={name} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5">
                <span className="text-xs font-bold text-slate-400 dark:text-slate-500 w-4 text-center shrink-0">{i + 1}</span>
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorFor(name).header}`} />
                <span className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{name}</span>
                <div className="flex gap-1 shrink-0">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                    className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-600 text-slate-500 dark:text-slate-300 disabled:opacity-20 hover:bg-slate-200 dark:hover:bg-slate-500 transition-colors text-xs font-bold">
                    ↑
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1}
                    className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-600 text-slate-500 dark:text-slate-300 disabled:opacity-20 hover:bg-slate-200 dark:hover:bg-slate-500 transition-colors text-xs font-bold">
                    ↓
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Rounds + snake */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Rounds</p>
          <select value={rounds} onChange={e => setRounds(Number(e.target.value))}
            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 font-medium focus:outline-none">
            {[8, 10, 12, 14, 15, 16, 17, 18, 20].map(n => <option key={n} value={n}>{n} rounds</option>)}
          </select>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Draft type</p>
          <div className="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5">
            {([true, false] as const).map(s => (
              <button type="button" key={String(s)} onClick={() => setSnake(s)}
                className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all ${snake === s ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>
                {s ? 'Snake' : 'Linear'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Draft name */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Draft name</p>
        <input type="text" value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="e.g. 2026 Season"
          className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-500" />
      </div>

      {/* Custom admin */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
          Extra admin <span className="normal-case font-normal">— optional</span>
        </p>
        <input type="text" value={admin} onChange={e => setAdmin(e.target.value)} placeholder="Name of additional admin"
          className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-500" />
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
          <span>★</span> Jon always has admin privileges
        </p>
      </div>

      {/* Player data */}
      <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-lg px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Player data</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            {playerUpdatedAt ? `Updated ${timeAgo(playerUpdatedAt)}` : 'Refreshes daily at midnight'}
          </p>
        </div>
        <button type="button" onClick={onRefreshPlayers} disabled={refreshing || loading}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 disabled:opacity-40 transition-colors">
          <span className={`text-sm ${refreshing ? 'animate-spin inline-block' : ''}`}>↻</span>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm rounded-lg px-4 py-3">{error}</p>}

      <button type="button"
        onClick={() => onStart(order, rounds, admin.trim(), snake, draftName.trim())}
        disabled={loading || refreshing}
        className="w-full bg-slate-900 dark:bg-slate-100 hover:bg-slate-700 dark:hover:bg-white disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white dark:text-slate-900 font-bold py-3 rounded-xl transition-colors text-sm tracking-wide"
      >
        {loading ? 'Starting draft…' : 'Start Draft'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lobby — Past drafts tab
// ─────────────────────────────────────────────────────────────────────────────

function PastDraftsTab({ history, isAdmin, onDelete }: {
  history:  ArchivedDraft[];
  isAdmin:  boolean;
  onDelete: (id: string) => void;
}) {
  const [expanded,   setExpanded]   = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <svg className="w-10 h-10 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <p className="text-sm font-medium">No past drafts yet</p>
        <p className="text-xs text-slate-600 mt-1">Completed drafts will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Inline delete confirmation */}
      {confirmDel && (
        <div className="bg-red-950/40 border border-red-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-red-300 font-medium">Delete this draft? This cannot be undone.</p>
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={() => setConfirmDel(null)}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors font-semibold">
              Cancel
            </button>
            <button type="button" onClick={() => { onDelete(confirmDel); setConfirmDel(null); }}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors font-semibold">
              Delete
            </button>
          </div>
        </div>
      )}

      {history.map((draft, idx) => {
        const isOpen    = expanded === draft.id;
        const date      = new Date(draft.archivedAt);
        const dateStr   = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const n         = draft.managers.length;
        const snake     = draft.snakeDraft !== false;

        // Group picks by slot for the expanded view
        const bySlot: DraftedPlayer[][] = Array.from({ length: n }, () => []);
        draft.picks.forEach(p => {
          const zero  = p.pickNumber - 1;
          const round = Math.floor(zero / n);
          const pos   = zero % n;
          const slot  = snake && round % 2 !== 0 ? n - 1 - pos : pos;
          if (slot >= 0 && slot < n) bySlot[slot].push(p);
        });

        return (
          <div key={draft.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            {/* Summary row */}
            <div className="flex items-start gap-3 px-4 py-3.5">
              <button type="button"
                onClick={() => setExpanded(isOpen ? null : draft.id)}
                className="flex items-start gap-3 flex-1 min-w-0 text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {draft.draftName || dateStr}
                    </span>
                    {draft.draftName && (
                      <span className="text-xs text-slate-400 dark:text-slate-500">{dateStr}</span>
                    )}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${draft.completed ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400' : 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400'}`}>
                      {draft.completed ? 'Complete' : 'Partial'}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{draft.picks.length} picks · {draft.rounds} rounds</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {draft.managers.map((m, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${colorFor(m).header}`} />
                        <span className="text-xs text-slate-500 dark:text-slate-400">{m}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </button>
              <div className="flex items-center gap-2 shrink-0 self-center">
                {isAdmin && (
                  <button type="button"
                    onClick={e => { e.stopPropagation(); setConfirmDel(draft.id); setExpanded(null); }}
                    className="text-slate-500 hover:text-red-400 transition-colors p-1 rounded-md hover:bg-red-950/30"
                    title="Delete draft"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
                <span className={`text-slate-400 dark:text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>▾</span>
              </div>
            </div>

            {/* Expanded picks */}
            {isOpen && (
              <div className="border-t border-slate-100 dark:border-slate-700">
                <div className="overflow-x-auto">
                  <div className="flex min-w-max">
                    {draft.managers.map((manager, i) => (
                      <div key={i} className="w-40 shrink-0 border-r border-slate-100 dark:border-slate-700 last:border-r-0">
                        <div className={`${colorFor(manager).header} text-white text-xs font-semibold py-2 px-3 text-center`}>
                          {manager}
                        </div>
                        <div className="max-h-72 overflow-y-auto">
                          {bySlot[i].length === 0 ? (
                            <p className="text-center text-xs text-slate-400 dark:text-slate-600 py-4">No picks</p>
                          ) : bySlot[i].map(p => (
                            <div key={p.pickNumber} className="flex items-center gap-1.5 px-2.5 py-2 border-b border-slate-50 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                              <span className="text-[10px] text-slate-300 dark:text-slate-600 w-3 shrink-0">{p.round}</span>
                              <div className="min-w-0">
                                <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate leading-tight">{p.name}</p>
                                <div className="flex items-center gap-1 mt-0.5">
                                  <PosBadge pos={p.pos} />
                                  <span className="text-[9px] text-slate-400 dark:text-slate-500">{p.team}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lobby screen (Lobby · Past Drafts · Admin★)
// ─────────────────────────────────────────────────────────────────────────────

function LobbyScreen(props: {
  myName:           string;
  isAdmin:          boolean;
  onStart:          (names: string[], rounds: number, adminName: string, snakeDraft: boolean, draftName: string) => void;
  onRefreshPlayers: () => void;
  onSwitchUser:     () => void;
  onDeleteHistory:  (id: string) => void;
  loading:          boolean;
  refreshing:       boolean;
  error:            string | null;
  playerUpdatedAt:  number | null;
  presence:         PresenceUser[];
  history:          ArchivedDraft[];
}) {
  type Tab = 'lobby' | 'past' | 'admin';
  const [tab, setTab] = useState<Tab>(props.isAdmin ? 'admin' : 'lobby');

  const tabs: { key: Tab; label: string; adminOnly?: boolean }[] = [
    { key: 'lobby', label: 'Lobby' },
    { key: 'past',  label: `Past Drafts${props.history.length ? ` (${props.history.length})` : ''}` },
    { key: 'admin', label: '★ Admin', adminOnly: true },
  ];

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff06_1px,transparent_1px),linear-gradient(to_bottom,#ffffff06_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none" />

      {/* Top bar */}
      <div className="relative shrink-0 flex items-center justify-between px-6 pt-6 pb-0">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-white/10 text-white/50 text-[10px] font-semibold px-2.5 py-1 rounded-full tracking-wider uppercase">Fantasy Football</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">4Man Drafting Portal</h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className="font-medium text-slate-300">{props.myName}</span>
          <button type="button" onClick={props.onSwitchUser} className="text-slate-600 hover:text-slate-400 transition-colors text-xs border border-slate-700 hover:border-slate-500 px-2 py-1 rounded-md">
            Switch
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="relative shrink-0 flex gap-0 px-6 mt-5 border-b border-slate-800">
        {tabs.filter(t => !t.adminOnly || props.isAdmin).map(({ key, label }) => (
          <button type="button"
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-semibold transition-colors relative ${
              tab === key
                ? key === 'admin' ? 'text-amber-400' : 'text-white'
                : key === 'admin' ? 'text-amber-600 hover:text-amber-400' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {label}
            {tab === key && <span className={`absolute bottom-0 left-2 right-2 h-0.5 rounded-full ${key === 'admin' ? 'bg-amber-400' : 'bg-white'}`} />}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="relative flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-md mx-auto">
          {tab === 'lobby' && (
            <LobbyTab myName={props.myName} presence={props.presence} />
          )}
          {tab === 'past' && (
            <PastDraftsTab history={props.history} isAdmin={props.isAdmin} onDelete={props.onDeleteHistory} />
          )}
          {tab === 'admin' && props.isAdmin && (
            <AdminSetupTab
              onStart={props.onStart}
              onRefreshPlayers={props.onRefreshPlayers}
              loading={props.loading}
              refreshing={props.refreshing}
              error={props.error}
              playerUpdatedAt={props.playerUpdatedAt}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft grid (left panel)
// ─────────────────────────────────────────────────────────────────────────────

function DraftGrid({ names, rounds, picks, currentPick, snake }: {
  names: string[]; rounds: number; picks: DraftedPlayer[]; currentPick: number; snake: boolean;
}) {
  const n = names.length;
  const pickMap = useMemo(() => {
    const m: Record<number, DraftedPlayer> = {};
    picks.forEach(p => { m[p.pickNumber] = p; });
    return m;
  }, [picks]);

  const currentRowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentPick]);

  return (
    <table className="border-collapse w-full text-xs table-fixed">
      <thead className="sticky top-0 z-10">
        <tr>
          {names.map((name, i) => (
            <th key={i} className={`${colorFor(names[i], i).header} text-white font-semibold py-2.5 px-2 text-center text-xs tracking-wide`}>
              {name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rounds }, (_, rIdx) => {
          const r = rIdx + 1;
          const isCurrentRound = currentPick > (r - 1) * n && currentPick <= r * n;
          return (
            <tr key={r} ref={isCurrentRound ? currentRowRef : undefined}>
              {names.map((_, m) => {
                const pn      = pickNum(m, r, n, snake);
                const drafted = pickMap[pn];
                const isCur   = pn === currentPick;
                const isPast  = pn < currentPick;
                const c       = colorFor(names[m], m);
                return (
                  <td key={m}
                    className={`border-b border-r border-slate-100 dark:border-slate-700/60 last:border-r-0 px-2 py-1.5 align-middle transition-colors ${
                      isCur   ? `${c.cell} ring-2 ring-inset ${c.border.replace('border-', 'ring-')}` :
                      drafted ? c.cell :
                      isPast  ? 'bg-slate-50 dark:bg-slate-800/50' : 'bg-white dark:bg-slate-900'
                    }`}
                    style={{ height: 48 }}
                  >
                    {drafted ? (
                      <div>
                        <p className={`font-semibold leading-tight truncate text-[11px] ${isPast ? 'text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'}`}>{drafted.name}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <PosBadge pos={drafted.pos} />
                          <span className="text-slate-400 dark:text-slate-500 text-[10px]">{drafted.team}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        {isCur
                          ? <span className={`text-[11px] font-bold ${c.text} animate-pulse`}>On Clock</span>
                          : <span className="text-[11px] text-slate-200 dark:text-slate-700 font-medium">{pn}</span>
                        }
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Teams view
// ─────────────────────────────────────────────────────────────────────────────

// Roster formation — order matters (players are greedily assigned top-to-bottom)
const ROSTER_SLOTS = [
  { label: 'QB',    positions: ['QB'],               count: 2 },
  { label: 'RB',    positions: ['RB'],               count: 3 },
  { label: 'WR',    positions: ['WR'],               count: 4 },
  { label: 'TE',    positions: ['TE'],               count: 1 },
  { label: 'FLEX',  positions: ['RB', 'WR', 'TE'],   count: 2 },
  { label: 'BN',    positions: ['QB', 'RB', 'WR', 'TE'], count: 6 },
] as const;

const SLOT_LABEL_COLORS: Record<string, string> = {
  QB:   'text-red-500  dark:text-red-400',
  RB:   'text-emerald-600 dark:text-emerald-400',
  WR:   'text-blue-500  dark:text-blue-400',
  TE:   'text-orange-500 dark:text-orange-400',
  FLEX: 'text-violet-500 dark:text-violet-400',
  BN:   'text-slate-400  dark:text-slate-500',
};

function assignRoster(teamPicks: DraftedPlayer[]): (DraftedPlayer | null)[] {
  // Sort by pick order so earlier picks fill starter slots first
  const sorted = [...teamPicks].sort((a, b) => a.pickNumber - b.pickNumber);
  const used   = new Set<string>();
  const result: (DraftedPlayer | null)[] = [];

  for (const slot of ROSTER_SLOTS) {
    for (let i = 0; i < slot.count; i++) {
      const match = sorted.find(p => !used.has(p.player_id) && (slot.positions as readonly string[]).includes(p.pos));
      if (match) { used.add(match.player_id); result.push(match); }
      else result.push(null);
    }
  }
  return result;
}

function TeamsView({ names, picks, snake }: {
  names: string[]; picks: DraftedPlayer[]; snake: boolean;
}) {
  const n = names.length;

  // Build per-manager pick lists
  const byManager = useMemo(() => {
    const map: Record<string, DraftedPlayer[]> = {};
    names.forEach(name => { map[name] = []; });
    picks.forEach(p => { if (map[p.manager]) map[p.manager].push(p); });
    return map;
  }, [picks, names]);

  // Assign each manager's picks to roster slots
  const rosters = useMemo(() => names.map(name => assignRoster(byManager[name] ?? [])), [names, byManager]);

  // Build the flat slot-label list (same order as ROSTER_SLOTS)
  const slotLabels: string[] = ROSTER_SLOTS.flatMap(s => Array(s.count).fill(s.label));

  // Group row indices by section for divider rendering
  const sectionStarts = new Set<number>();
  let idx = 0;
  for (const s of ROSTER_SLOTS) { sectionStarts.add(idx); idx += s.count; }

  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full border-collapse table-fixed">
        <thead>
          <tr className="sticky top-0 z-10">
            {/* Label column header */}
            <th className="w-10 bg-slate-50 dark:bg-slate-800 border-b border-r border-slate-200 dark:border-slate-700" />
            {names.map((name, i) => (
              <th key={i} className={`${colorFor(name, i).header} text-white font-semibold text-xs py-2.5 px-2 text-center tracking-wide border-r border-white/20 last:border-r-0`}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slotLabels.map((label, rowIdx) => (
            <tr key={rowIdx} className={sectionStarts.has(rowIdx) && rowIdx > 0 ? 'border-t-2 border-slate-200 dark:border-slate-600' : ''}>
              {/* Slot label cell */}
              <td className="w-10 bg-slate-50 dark:bg-slate-800/60 border-b border-r border-slate-100 dark:border-slate-700 text-center" style={{ height: 44 }}>
                <span className={`text-[9px] font-bold uppercase tracking-wider ${SLOT_LABEL_COLORS[label]}`}>{label}</span>
              </td>
              {/* Player cells */}
              {names.map((_, managerIdx) => {
                const p = rosters[managerIdx][rowIdx];
                return (
                  <td key={managerIdx}
                    className="border-b border-r border-slate-100 dark:border-slate-700/60 last:border-r-0 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    style={{ height: 44 }}>
                    {p ? (
                      <div className="flex items-center gap-1.5 px-1 h-full">
                        <PlayerPhoto playerId={p.player_id} team={p.team} size={28} />
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <p className="text-[10px] font-semibold text-slate-800 dark:text-slate-100 truncate leading-tight">{p.name}</p>
                          <span className="text-[9px] text-slate-400 dark:text-slate-500">{p.team}</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-[9px] text-slate-200 dark:text-slate-700 px-2">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Available players view
// ─────────────────────────────────────────────────────────────────────────────

function AvailableView({ players, draftedIds, onRequestDraft, isMyTurn, isAdmin, adminDraftForAll, currentManager, managerColor }: {
  players:          Player[];
  draftedIds:       Set<string>;
  onRequestDraft:   (p: Player) => void;
  isMyTurn:         boolean;
  isAdmin:          boolean;
  adminDraftForAll: boolean;
  currentManager:   string;
  managerColor:     ColorScheme;
}) {
  const [search, setSearch] = useState('');
  const [pos, setPos]       = useState<PosFilter>('ALL');
  const searchRef           = useRef<HTMLInputElement>(null);

  useEffect(() => { if (isMyTurn) searchRef.current?.focus(); }, [isMyTurn, currentManager]);

  const available = useMemo(() => players.filter(p => {
    if (draftedIds.has(p.player_id)) return false;
    if (pos !== 'ALL' && p.pos !== pos) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q);
    }
    return true;
  }), [players, draftedIds, pos, search]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900">
      {!isMyTurn && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Waiting for <span className="font-semibold text-slate-700 dark:text-slate-200">{currentManager}</span> to pick…
          </p>
        </div>
      )}
      <div className="shrink-0 px-3 pt-3 pb-2.5 space-y-2.5 border-b border-slate-100 dark:border-slate-700">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input ref={searchRef} type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search"
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-500 focus:bg-white dark:focus:bg-slate-700 transition-all" />
        </div>
        <div className="flex gap-1.5">
          {POSITIONS.map(p => (
            <button key={p} onClick={() => { setPos(p); setSearch(''); }}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${pos === p ? `${managerColor.header} text-white shadow-sm` : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {available.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-600">
            <svg className="w-8 h-8 mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-sm">No players found</p>
          </div>
        ) : (
          available.map((player, idx) => (
            <div key={player.player_id} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
              <span className="text-xs font-medium text-slate-300 dark:text-slate-600 w-5 text-right shrink-0 tabular-nums">{idx + 1}</span>
              <PlayerPhoto playerId={player.player_id} team={player.team} size={36} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate leading-tight">{player.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <PosBadge pos={player.pos} />
                  <span className="text-xs text-slate-400 dark:text-slate-500">{player.team}</span>
                  {player.bye  !== null && <span className="text-xs text-slate-300 dark:text-slate-600">· Bye {player.bye}</span>}
                  {player.status        && <span className="text-xs text-red-400 dark:text-red-500 font-medium">{player.status}</span>}
                </div>
              </div>
              {isMyTurn ? (
                <button onClick={() => onRequestDraft(player)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold text-white ${managerColor.header} hover:opacity-90 active:opacity-75 transition-opacity`}>
                  {isAdmin && adminDraftForAll ? `→ ${currentManager}` : 'Draft'}
                </button>
              ) : (
                <span className="shrink-0 w-14" />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft complete screen
// ─────────────────────────────────────────────────────────────────────────────

function CompletedScreen({ names, picks, rounds, snake, onReset }: {
  names: string[]; picks: DraftedPlayer[]; rounds: number; snake: boolean; onReset: () => void;
}) {
  const n = names.length;
  const bySlot = useMemo(() => {
    const arr: DraftedPlayer[][] = Array.from({ length: n }, () => []);
    picks.forEach(p => { const s = slotForPick(p.pickNumber, n, snake); if (s >= 0 && s < n) arr[s].push(p); });
    return arr;
  }, [picks, n, snake]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Draft Complete</h1>
          <p className="text-slate-500 text-sm">{rounds} rounds · {n * rounds} picks</p>
        </div>
        <button onClick={onReset} className="bg-white text-slate-900 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-slate-100 transition-colors">
          Return to Lobby
        </button>
      </div>
      <div className="flex-1 flex divide-x divide-slate-800 overflow-hidden">
        {names.map((name, i) => (
          <div key={i} className="flex-1 flex flex-col overflow-hidden">
            <div className={`${colorFor(name).header} text-white font-semibold text-xs text-center py-2.5 tracking-wide`}>{name}</div>
            <div className="flex-1 overflow-y-auto bg-slate-900">
              {bySlot[i].map(p => (
                <div key={p.pickNumber} className="flex items-center gap-2.5 px-3 py-2 border-b border-slate-800">
                  <span className="text-[10px] text-slate-600 w-4 text-right shrink-0 font-medium">{p.round}</span>
                  <PlayerPhoto playerId={p.player_id} team={p.team} size={28} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-200 truncate">{p.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <PosBadge pos={p.pos} />
                      <span className="text-[10px] text-slate-500">{p.team}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section selection screen (after login, before draft or picks)
// ─────────────────────────────────────────────────────────────────────────────

function SectionScreen({ myName, hasDraft, loading, error, onDraft, onPicks, onSwitch }: {
  myName:   string;
  hasDraft: boolean;
  loading:  boolean;
  error:    string | null;
  onDraft:  () => void;
  onPicks:  () => void;
  onSwitch: () => void;
}) {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff06_1px,transparent_1px),linear-gradient(to_bottom,#ffffff06_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none" />
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-white tracking-tight">4Man Drafting Portal</h1>
          <p className="text-slate-400 text-sm mt-1">Welcome back, <span className="text-white font-semibold">{myName}</span></p>
        </div>

        {error && (
          <p className="mb-4 bg-red-950/40 border border-red-800 text-red-400 text-sm rounded-xl px-4 py-2.5">{error}</p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={onDraft}
            disabled={loading}
            className="flex flex-col items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-2xl p-6 text-left transition-all group disabled:opacity-50"
          >
            <span className="text-3xl">🏈</span>
            <div>
              <p className="font-bold text-white text-base">Draft Board</p>
              <p className="text-slate-500 text-xs mt-0.5">
                {hasDraft ? 'Draft in progress' : 'League draft setup'}
              </p>
            </div>
            {hasDraft && (
              <span className="self-start text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                LIVE
              </span>
            )}
          </button>

          <button
            onClick={onPicks}
            disabled={loading}
            className="flex flex-col items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-2xl p-6 text-left transition-all group disabled:opacity-50"
          >
            <span className="text-3xl">📋</span>
            <div>
              <p className="font-bold text-white text-base">Weekly Picks</p>
              <p className="text-slate-500 text-xs mt-0.5">NFL game picks</p>
            </div>
          </button>
        </div>

        <button
          onClick={onSwitch}
          className="mt-6 w-full text-center text-xs text-slate-600 hover:text-slate-400 transition-colors"
        >
          Switch account
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────

type Screen  = 'login' | 'section' | 'setup' | 'draft';
type AppMode = 'draft' | 'picks';

export default function DraftBoard() {
  const [screen, setScreen]           = useState<Screen>('login');
  const [appMode, setAppMode]         = useState<AppMode>('draft');
  const [myName, setMyName]           = useState<string | null>(null);
  const [draftState, setDraftState]   = useState<DraftState | null>(null);
  const [players, setPlayers]         = useState<Player[]>([]);
  const [playerUpdatedAt, setPlayerUpdatedAt] = useState<number | null>(null);
  const [tab, setTab]                 = useState<'available' | 'teams'>('available');
  const [loading, setLoading]         = useState(false);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [dark, setDark]               = useState(false);
  const [confirm, setConfirm]         = useState<ConfirmProps | null>(null);
  const [showSettings,     setShowSettings]     = useState(false);
  const [adminDraftForAll, setAdminDraftForAll] = useState(false);
  const [leftPct, setLeftPct]         = useState(42);
  const [localMode, setLocalMode]     = useState(false);
  const [presence, setPresence]       = useState<PresenceUser[]>([]);
  const [history, setHistory]         = useState<ArchivedDraft[]>([]);
  const bodyRef                       = useRef<HTMLDivElement>(null);
  const dragging                      = useRef(false);
  const pollRef                       = useRef<ReturnType<typeof setInterval> | null>(null);
  const draftStateRef                 = useRef<typeof draftState>(draftState);
  const nullPollCount                 = useRef(0);
  const heartbeatRef                  = useRef<ReturnType<typeof setInterval> | null>(null);
  const presencePollRef               = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Startup ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const savedDark = localStorage.getItem(DARK_MODE_KEY);
    if (savedDark !== null) setDark(savedDark === 'true');
    const savedName = localStorage.getItem(NAME_KEY);
    if (savedName) {
      const canonical = HARDCODED_MANAGERS.find(m => m.toLowerCase() === savedName.toLowerCase()) ?? savedName;
      setMyName(canonical);
      if (canonical !== savedName) localStorage.setItem(NAME_KEY, canonical);
    }
  }, []);

  // ── Polling ───────────────────────────────────────────────────────────────

  const pollDraft = useCallback(async () => {
    try {
      const { state, localMode: lm } = await apiFetchDraft();
      setLocalMode(lm);
      // Only advance state forward — never backwards.
      // kv.get() may briefly return a stale entry after a write (Upstash
      // replica lag). Comparing updatedAt ensures a fresh pick can't be
      // overwritten by a lagging poll, and prevents re-render cascades when
      // the data is identical (same reference would be fine, new object isn't).
      if (state !== null) {
        nullPollCount.current = 0;
        setDraftState(prev => {
          if (prev && state.updatedAt <= prev.updatedAt) return prev;
          return state;
        });
      } else {
        // null can be a transient KV hiccup OR a genuinely reset draft.
        // Protect against single hiccups, but after 2 consecutive nulls
        // (~6s) accept that the draft is gone and return to the lobby.
        nullPollCount.current += 1;
        if (nullPollCount.current >= 2) {
          nullPollCount.current = 0;
          setDraftState(null);
          setScreen('setup');
        }
      }
    } catch { /* silent */ }
  }, []);

  // Keep the ref current so the poll effect can read draft state without
  // depending on it (which would restart the interval on every state change).
  useEffect(() => { draftStateRef.current = draftState; }, [draftState]);

  useEffect(() => {
    if (screen !== 'draft') {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    const start = () => {
      const s = draftStateRef.current;
      const done = s ? s.currentPick > s.managers.length * s.rounds : false;
      if (done) { if (pollRef.current) clearInterval(pollRef.current); return; }
      pollDraft();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        const cur = draftStateRef.current;
        const complete = cur ? cur.currentPick > cur.managers.length * cur.rounds : false;
        if (complete) { clearInterval(pollRef.current!); return; }
        pollDraft();
      }, POLL_MS);
    };
    start();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [screen, pollDraft]);

  // ── Heartbeat (keep presence alive while logged in) ───────────────────────
  // Only fires once the user is past the login screen to prevent premature
  // API route compilation and HMR dispatch errors during initial hydration.

  useEffect(() => {
    if (!myName || screen === 'login') {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      return;
    }
    const ping = () => fetch('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: myName }),
    }).then(r => r.json()).then(d => { if (d.users) setPresence(d.users); }).catch(() => {});
    ping();
    heartbeatRef.current = setInterval(ping, HEARTBEAT_MS);
    return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current); };
  }, [myName, screen]);

  // ── Presence polling (setup screen only) ──────────────────────────────────

  useEffect(() => {
    if (screen !== 'setup') {
      if (presencePollRef.current) clearInterval(presencePollRef.current);
      return;
    }
    const poll = () => fetch('/api/presence')
      .then(r => r.json()).then(d => { if (d.users) setPresence(d.users); }).catch(() => {});
    poll();
    presencePollRef.current = setInterval(poll, PRESENCE_POLL_MS);
    return () => { if (presencePollRef.current) clearInterval(presencePollRef.current); };
  }, [screen]);

  // ── Drag to resize ────────────────────────────────────────────────────────

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !bodyRef.current) return;
      const { left, width } = bodyRef.current.getBoundingClientRect();
      setLeftPct(Math.min(Math.max(((ev.clientX - left) / width) * 100, 20), 75));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // ── Login ─────────────────────────────────────────────────────────────────

  const handleLogin = useCallback(async (name: string) => {
    setLoading(true);
    setError(null);
    try {
      const { state, localMode: lm } = await apiFetchDraft();

      // Validate against the fixed member list + any custom admin in the draft
      const nameLower   = name.toLowerCase();
      const customAdmin = state?.adminName ?? '';
      const isAllowed   =
        HARDCODED_MEMBERS.has(nameLower) ||
        (customAdmin && name === customAdmin);
      if (!isAllowed) {
        setError('Name not recognised. Ask Jon to get access.');
        return;
      }

      // Normalize to canonical casing so name matches draftState.managers exactly
      // (e.g. "charlie" → "Charlie"). Falls back to typed name for custom admin.
      const canonicalName =
        HARDCODED_MANAGERS.find(m => m.toLowerCase() === nameLower) ?? name;

      setLocalMode(lm);
      setMyName(canonicalName);
      localStorage.setItem(NAME_KEY, canonicalName);
      nullPollCount.current = 0;
      setDraftState(state); // may be null — resolved when user picks Draft section
      setScreen('section');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not connect');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Enter draft section (from section selection screen) ───────────────────

  const handleEnterDraft = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAppMode('draft');
    try {
      if (draftState) {
        const { players: fetched, updatedAt } = await loadPlayers();
        setPlayers(fetched);
        setPlayerUpdatedAt(updatedAt);
        setScreen('draft');
      } else {
        const hist = await fetch('/api/draft/history').then(r => r.json()).then(d => d.history ?? []).catch(() => []);
        setHistory(hist);
        setScreen('setup');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load draft');
    } finally {
      setLoading(false);
    }
  }, [draftState]);

  // ── Start draft ───────────────────────────────────────────────────────────

  const handleStart = useCallback(async (names: string[], rounds: number, adminName: string, snakeDraft: boolean, draftName: string) => {
    setLoading(true);
    setError(null);
    try {
      const [state, { players: fetched, updatedAt }] = await Promise.all([
        apiStartDraft(names, rounds, adminName, snakeDraft, draftName),
        loadPlayers(),
      ]);
      nullPollCount.current = 0;
      setDraftState(state);
      setPlayers(fetched);
      setPlayerUpdatedAt(updatedAt);
      setScreen('draft');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Save settings ─────────────────────────────────────────────────────────

  const handleSaveSettings = useCallback(async (updates: Partial<DraftState>) => {
    const next = await apiUpdateSettings(updates);
    setDraftState(prev => (prev && next.updatedAt <= prev.updatedAt) ? prev : next);
  }, []);

  // ── Refresh players ───────────────────────────────────────────────────────

  const handleRefreshPlayers = useCallback(async () => {
    setRefreshing(true);
    try { await refreshPlayers(); } catch { /* ignore */ }
    finally { setRefreshing(false); }
  }, []);

  // ── Draft / undo / reset ──────────────────────────────────────────────────

  const commitDraft = useCallback(async (player: Player, pickAs: string) => {
    if (!draftState) return;
    setConfirm(null);
    try {
      const next = await apiPick(player, pickAs);
      setDraftState(prev => (prev && next.updatedAt <= prev.updatedAt) ? prev : next);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Pick failed';
      // If the server says there's no draft, it was reset from another
      // session — go back to the lobby immediately rather than showing an error.
      if (msg === 'No active draft' || msg === 'Draft is already complete') {
        setDraftState(null);
        setScreen('setup');
      } else {
        setError(msg);
      }
    }
  }, [draftState]);

  const requestDraft = useCallback((player: Player) => {
    if (!myName || !draftState) return;
    // Recompute who is on the clock at click-time (avoids stale-closure issues)
    const n2       = draftState.managers.length;
    const snake2   = draftState.snakeDraft !== false;
    const isDone2  = draftState.currentPick > n2 * draftState.rounds;
    const slot2    = isDone2 ? 0 : slotForPick(draftState.currentPick, n2, snake2);
    const onClock  = draftState.managers[slot2] ?? '';
    const amAdmin  = Boolean(myName && (HARDCODED_ADMINS.has(myName.toLowerCase()) || (draftState.adminName && myName.toLowerCase() === draftState.adminName.toLowerCase())));
    // Always use the canonical name from the managers array so it matches the server's case exactly
    const myCanonical = draftState.managers.find(m => m.toLowerCase() === myName.toLowerCase()) ?? myName;
    const pickAs   = (amAdmin && adminDraftForAll) ? onClock : myCanonical;
    setConfirm({
      title:        'Draft player?',
      message:      `Draft ${player.name} (${player.pos}, ${player.team}) for ${pickAs}?`,
      confirmLabel: 'Draft',
      onConfirm:    () => commitDraft(player, pickAs),
      onCancel:     () => setConfirm(null),
    });
  }, [myName, draftState, adminDraftForAll, commitDraft]);

  const commitUndo = useCallback(async () => {
    setConfirm(null);
    try { setDraftState(await apiUndo()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Undo failed'); }
  }, []);

  const requestUndo = useCallback(() => {
    if (!draftState?.picks.length) return;
    const last = draftState.picks[draftState.picks.length - 1];
    setConfirm({
      title:        'Undo last pick?',
      message:      `Remove ${last.name} (Pick ${last.pickNumber}, ${last.manager})?`,
      confirmLabel: 'Undo', danger: true,
      onConfirm:    commitUndo,
      onCancel:     () => setConfirm(null),
    });
  }, [draftState, commitUndo]);

  const commitReset = useCallback(async () => {
    setConfirm(null);
    await apiResetDraft();
    setDraftState(null);
    const hist = await fetch('/api/draft/history').then(r => r.json()).then(d => d.history ?? []).catch(() => []);
    setHistory(hist);
    setScreen('setup');
  }, []);

  const requestReset = useCallback(() => {
    setConfirm({
      title: 'Reset draft?', message: 'All picks will be lost and everyone will return to setup.',
      confirmLabel: 'Reset', danger: true,
      onConfirm:    commitReset,
      onCancel:     () => setConfirm(null),
    });
  }, [commitReset]);

  const handleDeleteHistory = useCallback(async (id: string) => {
    const { history: updated } = await fetch('/api/draft/history', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(r => r.json()).catch(() => ({ history: [] }));
    setHistory(updated);
  }, []);

  const toggleDark = useCallback(() => {
    setDark(d => { const next = !d; localStorage.setItem(DARK_MODE_KEY, String(next)); return next; });
  }, []);

  const switchUser = () => {
    localStorage.removeItem(NAME_KEY);
    setMyName(null);
    setScreen('login');
    setError(null);
  };

  // ── Derived values ────────────────────────────────────────────────────────

  const n          = draftState?.managers.length ?? 0;
  const snake      = draftState?.snakeDraft !== false;
  const totalPicks = n * (draftState?.rounds ?? 0);
  const isDone     = draftState ? draftState.currentPick > totalPicks : false;
  const curSlot    = draftState && !isDone ? slotForPick(draftState.currentPick, n, snake) : 0;
  const curManager = draftState?.managers[curSlot] ?? '';
  const curColors  = colorFor(curManager);
  const mySlot     = myName && draftState ? draftState.managers.findIndex(m => m.toLowerCase() === myName.toLowerCase()) : -1;
  const isAdmin    = Boolean(
    myName && (
      HARDCODED_ADMINS.has(myName.toLowerCase()) ||
      (draftState?.adminName && myName === draftState.adminName)
    )
  );
  const isMyTurn   = !isDone && (
    (isAdmin && adminDraftForAll) ||
    (mySlot >= 0 && draftState ? slotForPick(draftState.currentPick, n, snake) === mySlot : false)
  );
  const draftedIds = useMemo(() => new Set((draftState?.picks ?? []).map(p => p.player_id)), [draftState]);

  // ── Render ────────────────────────────────────────────────────────────────

  // ── Picks section ─────────────────────────────────────────────────────────

  if (appMode === 'picks' && myName) {
    return (
      <PicksBoard
        myName={myName}
        dark={dark}
        onLeave={() => { setAppMode('draft'); setScreen('section'); }}
      />
    );
  }

  // ── Draft section + section selection ─────────────────────────────────────

  return (
    <div className={dark ? 'dark' : ''}>
      {confirm      && <ConfirmModal {...confirm} />}
      {showSettings && draftState && (
        <SettingsModal state={draftState} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />
      )}

      {screen === 'login' && (
        <LoginScreen onLogin={handleLogin} loading={loading} error={error} />
      )}

      {screen === 'section' && myName && (
        <SectionScreen
          myName={myName}
          hasDraft={Boolean(draftState)}
          loading={loading}
          error={error}
          onDraft={handleEnterDraft}
          onPicks={() => setAppMode('picks')}
          onSwitch={switchUser}
        />
      )}

      {screen === 'setup' && myName && (
        <LobbyScreen
          myName={myName} isAdmin={isAdmin} onStart={handleStart} onRefreshPlayers={handleRefreshPlayers}
          onSwitchUser={switchUser} onDeleteHistory={handleDeleteHistory}
          loading={loading} refreshing={refreshing} error={error} playerUpdatedAt={playerUpdatedAt}
          presence={presence} history={history}
        />
      )}

      {screen === 'draft' && isDone && draftState && (
        <CompletedScreen names={draftState.managers} picks={draftState.picks} rounds={draftState.rounds} snake={snake} onReset={commitReset} />
      )}

      {screen === 'draft' && !isDone && draftState && (() => {
        const progress = Math.round(((draftState.currentPick - 1) / totalPicks) * 100);
        return (
          <div className="h-screen flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950">

            {/* Nav */}
            <nav className="shrink-0 bg-slate-900 flex items-center gap-3 px-4 py-2.5">
              <span className="font-bold text-sm text-white tracking-tight">4Man Drafting Portal</span>
              <div className="w-px h-4 bg-slate-700" />
              <div className="flex items-center gap-2 flex-1 max-w-xs">
                <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">{draftState.currentPick} / {totalPicks}</span>
              </div>
              {!snake && (
                <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-1 rounded-md font-medium hidden sm:block">Linear</span>
              )}
              <div className="flex-1" />
              {myName && (
                <div className="flex items-center gap-2">
                  {isAdmin
                    ? <span className="text-amber-400 text-xs">★</span>
                    : mySlot >= 0 && <div className={`w-2 h-2 rounded-full ${colorFor(myName ?? '').header}`} />
                  }
                  <span className="text-xs text-slate-300 font-medium">{myName}</span>
                  {isAdmin && <span className="text-[10px] text-amber-500 bg-amber-950/40 px-1.5 py-0.5 rounded font-semibold">admin</span>}
                  <button onClick={switchUser} className="text-xs text-slate-600 hover:text-slate-400 transition-colors">↩</button>
                </div>
              )}
              {localMode && (
                <span className="text-[10px] text-red-400 bg-red-950/40 border border-red-800 px-2 py-1 rounded-md font-semibold">⚠ No KV</span>
              )}
              {isAdmin && draftState.picks.length > 0 && (
                <button onClick={requestUndo} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg font-medium transition-colors">
                  ↩ Undo
                </button>
              )}
              {isAdmin && (
                <>
                  <button
                    onClick={() => setAdminDraftForAll(v => !v)}
                    title={adminDraftForAll ? 'Drafting for all teams — click to restrict to your pick' : 'Click to draft for any team'}
                    className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors border ${
                      adminDraftForAll
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                        : 'text-slate-500 border-slate-700 hover:text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {adminDraftForAll ? '★ Drafting for all' : '★ Own pick only'}
                  </button>
                  <button onClick={requestReset} className="text-xs text-slate-600 hover:text-slate-300 transition-colors font-medium px-1">Reset</button>
                  <button onClick={() => setShowSettings(true)} className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors" aria-label="Settings">
                    <GearIcon />
                  </button>
                </>
              )}
              <button onClick={toggleDark} className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors" aria-label="Toggle dark mode">
                {dark ? <SunIcon /> : <MoonIcon />}
              </button>
            </nav>

            {/* Local-mode warning — picks won't persist without KV */}
            {localMode && (
              <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-xs font-semibold">
                ⚠ KV storage not connected — picks will not sync between users. Check Vercel → Storage → KV is linked to this project.
              </div>
            )}

            {/* Error toast */}
            {error && (
              <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-red-600 text-white text-sm font-medium">
                <span className="flex-1">{error}</span>
                <button onClick={() => setError(null)} className="text-white/70 hover:text-white text-lg leading-none">✕</button>
              </div>
            )}

            {/* On the clock banner */}
            <div className={`shrink-0 ${curColors.header} px-5 py-2.5 flex items-center justify-between`}>
              <div className="flex items-center gap-3">
                <span className="text-white/60 text-[11px] font-semibold uppercase tracking-widest">On the Clock</span>
                <span className="text-white font-bold text-lg leading-none">{curManager}</span>
                {isMyTurn && (
                  <span className="bg-white/20 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                    {isAdmin && adminDraftForAll && myName !== curManager ? 'Drafting as admin' : 'Your pick!'}
                  </span>
                )}
              </div>
              <span className="text-white/70 text-xs font-semibold tabular-nums">
                Round {roundForPick(draftState.currentPick, n)} &nbsp;·&nbsp; Pick {draftState.currentPick}
              </span>
            </div>

            {/* Body */}
            <div ref={bodyRef} className="flex-1 flex min-h-0">
              <div className="flex flex-col overflow-hidden" style={{ width: `${leftPct}%` }}>
                <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900">
                  <DraftGrid names={draftState.managers} rounds={draftState.rounds} picks={draftState.picks} currentPick={draftState.currentPick} snake={snake} />
                </div>
              </div>
              <div onMouseDown={startDrag} className="shrink-0 w-1.5 cursor-col-resize bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 active:bg-blue-400 transition-colors group relative" title="Drag to resize">
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  {[0,1,2,3,4].map(i => <div key={i} className="w-0.5 h-0.5 rounded-full bg-slate-500 dark:bg-slate-400" />)}
                </div>
              </div>
              <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-slate-900">
                <div className="shrink-0 flex border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900">
                  {(['available', 'teams'] as const).map(t => (
                    <button key={t} onClick={() => setTab(t)}
                      className={`flex-1 py-3 text-xs font-semibold tracking-wide transition-all relative ${tab === t ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400'}`}>
                      {t === 'available' ? 'Available Players' : 'Teams'}
                      {tab === t && <span className={`absolute bottom-0 left-4 right-4 h-0.5 rounded-full ${curColors.header}`} />}
                    </button>
                  ))}
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  {tab === 'available' ? (
                    <AvailableView
                      players={players} draftedIds={draftedIds}
                      onRequestDraft={requestDraft}
                      isMyTurn={isMyTurn} isAdmin={isAdmin} adminDraftForAll={adminDraftForAll}
                      currentManager={curManager} managerColor={curColors}
                    />
                  ) : (
                    <TeamsView names={draftState.managers} picks={draftState.picks} snake={snake} />
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Helper used in confirm message (avoids referencing derived var before it exists in the callback)
function currentManagerName(state: DraftState): string {
  const n     = state.managers.length;
  const snake = state.snakeDraft !== false;
  const slot  = slotForPick(state.currentPick, n, snake);
  return state.managers[slot] ?? '';
}
