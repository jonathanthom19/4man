import type { PicksState } from './types';

const PICKS_KEY = 'fantasy_picks_state';

let memPicksState: PicksState | null = null;

function hasKv(): boolean {
  return Boolean(process.env.KV_REST_API_URL);
}

export async function getPicksState(): Promise<PicksState | null> {
  if (hasKv()) {
    const { kv } = await import('@vercel/kv');
    return kv.get<PicksState>(PICKS_KEY);
  }
  return memPicksState;
}

export async function setPicksState(state: PicksState | null): Promise<void> {
  if (hasKv()) {
    const { kv } = await import('@vercel/kv');
    if (state === null) {
      await kv.del(PICKS_KEY);
    } else {
      await kv.set(PICKS_KEY, state);
    }
    return;
  }
  memPicksState = state;
}
