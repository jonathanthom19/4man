const LOCK_TTL_SECONDS = 15;
const LOCK_WAIT_MS = 10_000;
const RETRY_MS = 40;

const localTails = new Map<string, Promise<void>>();

function hasKv(): boolean {
  return Boolean(process.env.KV_REST_API_URL);
}

async function withLocalLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const previous = localTails.get(name) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => current);
  localTails.set(name, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (localTails.get(name) === tail) localTails.delete(name);
  }
}

/** Serialize a state mutation across server instances. */
export async function withStateLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (!hasKv()) return withLocalLock(name, work);

  const { kv } = await import('@vercel/kv');
  const key = `fantasy_lock:${name}`;
  const token = crypto.randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;

  while (Date.now() < deadline) {
    const acquired = await kv.set(key, token, { nx: true, ex: LOCK_TTL_SECONDS });
    if (acquired) {
      try {
        return await work();
      } finally {
        await kv.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          [key],
          [token],
        );
      }
    }
    await new Promise(resolve => setTimeout(resolve, RETRY_MS));
  }

  throw new Error(`Timed out waiting for ${name} state lock`);
}
