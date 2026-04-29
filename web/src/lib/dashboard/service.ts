import { revalidateTag, unstable_cache } from "next/cache";

import { buildDashboardPayloadUncached } from "@/lib/dashboard/build";
import {
  DASHBOARD_CACHE_REVALIDATE_SECONDS,
  DASHBOARD_CACHE_TAG,
} from "@/lib/dashboard/config";
import { recordCacheInvalidation } from "@/lib/dashboard/health-state";

const getCachedPayload = unstable_cache(buildDashboardPayloadUncached, [DASHBOARD_CACHE_TAG], {
  revalidate: DASHBOARD_CACHE_REVALIDATE_SECONDS,
  tags: [DASHBOARD_CACHE_TAG],
});

export async function getDashboardPayload() {
  return getCachedPayload();
}

export function invalidateDashboardPayloadCache() {
  revalidateTag(DASHBOARD_CACHE_TAG, "max");
  recordCacheInvalidation(new Date().toISOString());
}
