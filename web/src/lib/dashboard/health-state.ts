type BuildHealth = {
  lastPayloadBuiltAt: string | null;
  lastPayloadBuildDurationMs: number | null;
  lastSheetsCheckAt: string | null;
  lastSheetsCheckOk: boolean | null;
  lastCacheInvalidatedAt: string | null;
};

const state: BuildHealth = {
  lastPayloadBuiltAt: null,
  lastPayloadBuildDurationMs: null,
  lastSheetsCheckAt: null,
  lastSheetsCheckOk: null,
  lastCacheInvalidatedAt: null,
};

export function recordPayloadBuild(durationMs: number, builtAt: string) {
  state.lastPayloadBuildDurationMs = durationMs;
  state.lastPayloadBuiltAt = builtAt;
}

export function recordSheetsCheck(ok: boolean, checkedAt: string) {
  state.lastSheetsCheckOk = ok;
  state.lastSheetsCheckAt = checkedAt;
}

export function recordCacheInvalidation(when: string) {
  state.lastCacheInvalidatedAt = when;
}

export function getHealthState() {
  return { ...state };
}
