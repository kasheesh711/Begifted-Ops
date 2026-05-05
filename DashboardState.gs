// ============================================================
// SNAPSHOT STORAGE AND CACHE
// ============================================================

function loadSnapshotState() {
  if (typeof PropertiesService === "undefined") {
    return { lastSnapshot: null, history: [] };
  }

  const properties = PropertiesService.getScriptProperties();

  return {
    lastSnapshot: parseJsonSafely(properties.getProperty(SNAPSHOT_STATE_KEY)),
    history: parseJsonSafely(properties.getProperty(HISTORY_STATE_KEY)) || [],
  };
}

function persistSnapshotState(snapshotState) {
  if (typeof PropertiesService === "undefined") return;

  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(SNAPSHOT_STATE_KEY, JSON.stringify(snapshotState.lastSnapshot));
  properties.setProperty(HISTORY_STATE_KEY, JSON.stringify(snapshotState.history));
}

function getDashboardCache() {
  if (typeof CacheService === "undefined") return null;
  return CacheService.getScriptCache();
}

function readChunkedCacheValue(cache, cacheKey) {
  if (!cache) return null;

  const meta = readChunkedCacheManifest(cache, cacheKey);
  if (!meta || !meta.parts || meta.parts < 1) {
    return null;
  }

  const partKeys = [];
  for (let index = 0; index < meta.parts; index++) {
    partKeys.push(getDashboardCachePartKey(cacheKey, index));
  }

  const parts = cache.getAll(partKeys);
  let serialized = "";

  for (let index = 0; index < partKeys.length; index++) {
    const value = parts[partKeys[index]];
    if (typeof value !== "string") {
      return null;
    }
    serialized += value;
  }

  return parseJsonSafely(serialized);
}

function readChunkedCacheManifest(cache, cacheKey) {
  if (!cache) return null;
  return parseJsonSafely(cache.get(getDashboardCacheMetaKey(cacheKey)));
}

function writeChunkedCacheValue(cache, cacheKey, value, ttlSeconds) {
  if (!cache) return;

  const serialized = JSON.stringify(value);
  const chunks = chunkString(serialized, DASHBOARD_CACHE_CHUNK_SIZE);
  const values = {};

  values[getDashboardCacheMetaKey(cacheKey)] = JSON.stringify({ parts: chunks.length });

  chunks.forEach(function(chunk, index) {
    values[getDashboardCachePartKey(cacheKey, index)] = chunk;
  });

  cache.putAll(values, ttlSeconds);
}

function clearDashboardCache(cache, cacheKey) {
  if (!cache) return;

  const metaKey = getDashboardCacheMetaKey(cacheKey);
  const meta = readChunkedCacheManifest(cache, cacheKey);
  const keysToRemove = [metaKey];

  if (meta && meta.parts && meta.parts > 0) {
    for (let index = 0; index < meta.parts; index++) {
      keysToRemove.push(getDashboardCachePartKey(cacheKey, index));
    }
  }

  if (typeof cache.removeAll === "function") {
    cache.removeAll(keysToRemove);
    return;
  }

  if (typeof cache.remove === "function") {
    keysToRemove.forEach(function(key) {
      cache.remove(key);
    });
  }
}

function getDashboardCacheMetaKey(cacheKey) {
  return cacheKey + "::meta";
}

function getDashboardCachePartKey(cacheKey, index) {
  return cacheKey + "::part::" + index;
}

function chunkString(value, chunkSize) {
  const chunks = [];

  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize));
  }

  return chunks.length ? chunks : [""];
}
