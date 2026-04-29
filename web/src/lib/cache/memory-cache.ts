type Entry<T> = {
  expiresAt: number;
  value: T;
};

const cache = new Map<string, Entry<unknown>>();

export function getMemoryCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setMemoryCache<T>(key: string, value: T, ttlMs: number) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  return value;
}

export async function getOrSetMemoryCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = getMemoryCache<T>(key);
  if (cached !== null) return cached;
  const value = await loader();
  return setMemoryCache(key, value, ttlMs);
}

export function clearMemoryCache(keyPrefix?: string) {
  if (!keyPrefix) {
    cache.clear();
    return;
  }

  for (const key of cache.keys()) {
    if (key.startsWith(keyPrefix)) {
      cache.delete(key);
    }
  }
}
