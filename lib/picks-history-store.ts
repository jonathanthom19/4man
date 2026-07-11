import type { ArchivedPicksWeek } from './types';

const HISTORY_KEY = 'fantasy_picks_history';

let memHistory: ArchivedPicksWeek[] = [];

function hasKv(): boolean {
  return Boolean(process.env.KV_REST_API_URL);
}

async function loadHistory(): Promise<ArchivedPicksWeek[]> {
  if (hasKv()) {
    const { kv } = await import('@vercel/kv');
    return (await kv.get<ArchivedPicksWeek[]>(HISTORY_KEY)) ?? [];
  }
  return memHistory;
}

async function saveHistory(history: ArchivedPicksWeek[]): Promise<void> {
  if (hasKv()) {
    const { kv } = await import('@vercel/kv');
    await kv.set(HISTORY_KEY, history);
    return;
  }
  memHistory = history;
}

export async function getPicksHistory(): Promise<ArchivedPicksWeek[]> {
  return loadHistory();
}

export async function getPicksHistoryBySeason(season: string): Promise<ArchivedPicksWeek[]> {
  const history = await loadHistory();
  return history
    .filter(h => h.season === season)
    .sort((a, b) => b.archivedAt - a.archivedAt);
}

export async function getPicksSeasons(): Promise<string[]> {
  const history = await loadHistory();
  const seasons = new Set(history.map(h => h.season));
  return [...seasons].sort((a, b) => b.localeCompare(a));
}

export async function archivePicksWeek(week: ArchivedPicksWeek): Promise<void> {
  const history = await loadHistory();
  const filtered = history.filter(h => h.id !== week.id);
  await saveHistory([week, ...filtered]);
}

export async function setPicksHistory(history: ArchivedPicksWeek[]): Promise<void> {
  await saveHistory(history);
}
