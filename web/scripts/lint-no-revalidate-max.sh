#!/usr/bin/env bash
set -euo pipefail

# Phase 3 SVC-02 / 03-RESEARCH.md §Pitfall 5 — flipped semantics.
#
# In Phase 2 this script forbade the revalidateTag(tag, "max") two-arg form
# (treated as anti-pattern) and allowlisted lib/dashboard/service.ts as the
# one tolerated occurrence pending the Phase 3 cutover.
#
# Phase 3 inverts the intent: revalidateTag(tag, "max") is the CORRECT Next.js
# 16 invocation from Route Handlers (Server-Actions-only updateTag() must NOT
# be used in route handlers per Next.js docs). The deprecated single-arg form
# revalidateTag(tag) silently inherits a default profile and is what we now
# guard against.
#
# Allowlist is empty: there are no legitimate uses of the single-arg deprecated
# form in this codebase after the Phase 3 cutover. Any new occurrence fails.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$REPO_ROOT/src"

# Allowlist: empty — no legitimate uses of the single-arg deprecated form remain.
ALLOWLIST=()

# Pattern matches: revalidateTag(<single-arg>) — the Next.js 16 deprecated form.
# Two-arg form revalidateTag(tag, "max") is the recommended Next.js 16 invocation
# and is NOT matched by this regex (the [^,)]+ excludes commas).
PATTERN='revalidateTag\([^,)]+\)'

echo "Scanning $SRC_DIR for deprecated single-arg revalidateTag() form..."

cd "$REPO_ROOT"
MATCHES=$(grep -rEn "$PATTERN" src/ 2>/dev/null || true)

if [ -z "$MATCHES" ]; then
  echo "lint-no-revalidate-max: OK (no matches)"
  exit 0
fi

# Partition matches into allowlisted vs non-allowlisted.
# Note: bash's `set -u` errors on `${ALLOWLIST[@]}` when the array is empty,
# so we guard the expansion via `${ALLOWLIST[@]+"${ALLOWLIST[@]}"}` which
# expands to nothing when ALLOWLIST is empty (POSIX-style "alternate value").
NON_ALLOWLISTED=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  FILE_PATH=$(echo "$line" | cut -d: -f1)
  ALLOWED=0
  for a in ${ALLOWLIST[@]+"${ALLOWLIST[@]}"}; do
    if [ "$FILE_PATH" = "$a" ]; then
      ALLOWED=1
      break
    fi
  done
  if [ "$ALLOWED" = "0" ]; then
    NON_ALLOWLISTED+="${line}"$'\n'
  fi
done <<< "$MATCHES"

if [ -z "$NON_ALLOWLISTED" ]; then
  echo "lint-no-revalidate-max: OK (all matches are allowlisted)"
  echo ""
  echo "Allowlisted occurrences:"
  echo "$MATCHES"
  exit 0
fi

echo ""
echo "lint-no-revalidate-max: FAIL"
echo ""
echo "The deprecated single-arg revalidateTag() form was found:"
echo ""
echo "$NON_ALLOWLISTED"
echo ""
echo "Next.js 16 deprecates revalidateTag(tag) without a profile."
echo "Use the two-arg form instead:"
echo "  revalidateTag(DASHBOARD_CACHE_TAG, \"max\")   # correct (Next.js 16)"
echo "  revalidateTag(DASHBOARD_CACHE_TAG)           # WRONG — deprecated single-arg form"
echo ""
echo "See .planning/phases/03-service-cutover/03-RESEARCH.md §Pitfall 5."
exit 1
