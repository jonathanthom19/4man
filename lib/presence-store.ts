// Each user's heartbeat is written atomically as an individual hash field,
// so concurrent heartbeats from multiple users never overwrite each other.

const PRESENCE_KEY = 'fantasy_presence';
const STALE_MS     = 60_000;
const EXPIRE_SECS  = 300;

type PresenceMap = Record<string, number>;

let memPresence: PresenceMap = {};

function hasKv(): boolean {
  return Boolean(process.env.KV_REST_API_URL);
}

export async function heartbeat(name: string): Promise<void> {
  if (hasKv()) {
    const { kv } = await import('@vercel/kv');
    // hset writes a single field atomically — no read-modify-write needed
    await kv.hset(PRESENCE_KEY, { [name]: Date.now() });
    await kv.expire(PRESENCE_KEY, EXPIRE_SECS);
    return;
  }
  memPresence[name] = Date.now();
}

export async function getActive(): Promise<Array<{ name: string; lastSeenAt: number }>> {
  let map: PresenceMap;

  if (hasKv()) {
    const { kv } = await import('@vercel/kv');
    map = (await kv.hgetall<PresenceMap>(PRESENCE_KEY)) ?? {};
  } else {
    map = memPresence;
  }

  const now = Date.now();
  return Object.entries(map)
    .filter(([, ts]) => now - Number(ts) < STALE_MS)
    .sort(([, a], [, b]) => Number(b) - Number(a))
    .map(([name, lastSeenAt]) => ({ name, lastSeenAt: Number(lastSeenAt) }));
}
