import type { LineHistoryEntry, LineHistorySource, NFLGame } from './types';

function sameSpread(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a === b;
}

/** Append a history snapshot when the home spread changes (or seed an opening line). */
export function appendLineHistory(
  prior: NFLGame | undefined,
  homeSpread: number | null,
  source: LineHistorySource,
  at = Date.now(),
): LineHistoryEntry[] {
  const history = [...(prior?.lineHistory ?? [])];
  const last = history[history.length - 1];

  if (!history.length) {
    return [{ homeSpread, at, source: prior ? source : 'open' }];
  }

  if (sameSpread(last.homeSpread, homeSpread)) {
    return history;
  }

  history.push({ homeSpread, at, source });
  return history;
}

export function formatHomeSpread(homeSpread: number | null | undefined): string {
  if (homeSpread == null) return 'N/A';
  if (homeSpread === 0) return 'PK';
  return homeSpread > 0 ? `+${homeSpread}` : String(homeSpread);
}
