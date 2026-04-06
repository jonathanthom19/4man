// Presence is a simple { name → lastSeenAt } map.
// Active = pinged within the last STALE_MS milliseconds.

const PRESENCE_KEY = 'fantasy_presence';
const STALE_MS     = 30_000;

type PresenceMap = Record<string, number>;

let memPresence: PresenceMap = {};

function hasKv(): boolean {
  return Boolean(process.env.KV_REST_API_URL);
}

async function getMap(): Promise<PresenceMap> {
  if (hasKv()) {
    const { kv } = await import('@vercel/kv');
    return (await kv.get<PresenceMap>(PRESENCE_KEY)) ?? {};
  }
  return memPresence;
}

async function saveMap(map: PresenceMap): Promise<void> {
  if (hasKv()) {
    const { kv } = await import('@vercel/kv');
    await kv.set(PRESENCE_KEY, map, { ex: 300 }); // auto-expire after 5 min of no activity
    return;
  }
  memPresence = map;
}

export async function heartbeat(name: string): Promise<void> {
  const map = await getMap();
  map[name] = Date.now();
  await saveMap(map);
}

export async function getActive(): Promise<Array<{ name: string; lastSeenAt: number }>> {
  const map   = await getMap();
  const now   = Date.now();
  const alive = Object.entries(map)
    .filter(([, ts]) => now - ts < STALE_MS)
    .sort(([, a], [, b]) => b - a) // most recent first
    .map(([name, lastSeenAt]) => ({ name, lastSeenAt }));

  // Prune stale entries
  const pruned = Object.fromEntries(Object.entries(map).filter(([, ts]) => now - ts < STALE_MS));
  if (Object.keys(pruned).length !== Object.keys(map).length) await saveMap(pruned);

  return alive;
}
