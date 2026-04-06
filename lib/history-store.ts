import type { DraftState, ArchivedDraft } from './types';

const HISTORY_KEY = 'fantasy_draft_history';
const MAX_ENTRIES = 20;

let memHistory: ArchivedDraft[] = [];

function hasKv(): boolean {
  return Boolean(process.env.KV_REST_API_URL);
}

async function loadHistory(): Promise<ArchivedDraft[]> {
  if (hasKv()) {
    const { kv } = await import('@vercel/kv');
    return (await kv.get<ArchivedDraft[]>(HISTORY_KEY)) ?? [];
  }
  return memHistory;
}

async function saveHistory(history: ArchivedDraft[]): Promise<void> {
  if (hasKv()) {
    const { kv } = await import('@vercel/kv');
    await kv.set(HISTORY_KEY, history);
    return;
  }
  memHistory = history;
}

export async function getHistory(): Promise<ArchivedDraft[]> {
  return loadHistory();
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const history = await loadHistory();
  await saveHistory(history.filter(h => h.id !== id));
}

export async function archiveDraft(state: DraftState): Promise<void> {
  if (state.picks.length === 0) return; // nothing worth saving

  const totalPicks = state.managers.length * state.rounds;
  const completed  = state.currentPick > totalPicks;

  const entry: ArchivedDraft = {
    id:         String(state.startedAt),
    archivedAt: Date.now(),
    startedAt:  state.startedAt,
    managers:   state.managers,
    rounds:     state.rounds,
    picks:      state.picks,
    snakeDraft: state.snakeDraft,
    completed,
    ...(state.draftName ? { draftName: state.draftName } : {}),
  };

  const history = await loadHistory();
  // Replace if same draft was previously archived (same id), otherwise prepend
  const filtered = history.filter(h => h.id !== entry.id);
  await saveHistory([entry, ...filtered].slice(0, MAX_ENTRIES));
}
