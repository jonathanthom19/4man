import type { DraftState } from './types';

const DRAFT_KEY = 'fantasy_draft_state';

function hasKv(): boolean {
  return Boolean(process.env.KV_REST_API_URL);
}

// ─── In-memory fallback for local dev ────────────────────────────────────────
// Works within a single Next.js dev-server process. Not suitable for
// multi-instance production — use Vercel KV there.
let memState: DraftState | null = null;

export async function getDraftState(): Promise<DraftState | null> {
  if (hasKv()) {
    const { kv } = await import('@vercel/kv');
    return kv.get<DraftState>(DRAFT_KEY);
  }
  return memState;
}

export async function setDraftState(state: DraftState | null): Promise<void> {
  if (hasKv()) {
    const { kv } = await import('@vercel/kv');
    if (state === null) {
      await kv.del(DRAFT_KEY);
    } else {
      await kv.set(DRAFT_KEY, state);
    }
    return;
  }
  memState = state;
}

export { hasKv };
