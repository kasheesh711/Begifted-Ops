#!/usr/bin/env bash
set -euo pipefail

# TEST-03 deferral carve-out per D-23 / 02-RESEARCH.md §TEST-03 placement.
#
# Phase 2 does NOT test cache-invalidation at runtime (the `use cache: remote`
# infrastructure doesn't exist yet — it lands in Phase 3 SVC-02). This static
# lint closes the gap by preventing new code paths from introducing the
# revalidateTag(..., "max") anti-pattern flagged in CONCERNS.md (MEDIUM).
#
# Allowlist: the known existing occurrence in lib/dashboard/service.ts is
# tolerated through Phase 2. Phase 3 SVC-02 removes both the occurrence and
# this allowlist entry in the same PR. All OTHER occurrences FAIL the lint.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$REPO_ROOT/src"

# Files where existing occurrences are tolerated until Phase 3 rewrites them.
# Paths are relative to web/ (the repo_root this script computes).
ALLOWLIST=(
  "src/lib/dashboard/service.ts"
)

# Pattern matches: revalidateTag(<anything>, "max")  OR  revalidateTag(<anything>, 'max')
# The whitespace around the comma is optional.
PATTERN='revalidateTag\([^)]*,[[:space:]]*["'"'"']max["'"'"']\)'

echo "Scanning $SRC_DIR for revalidateTag(..., 'max') anti-pattern..."

cd "$REPO_ROOT"
MATCHES=$(grep -rEn "$PATTERN" src/ 2>/dev/null || true)

if [ -z "$MATCHES" ]; then
  echo "lint-no-revalidate-max: OK (no matches)"
  exit 0
fi

# Partition matches into allowlisted vs non-allowlisted.
NON_ALLOWLISTED=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  FILE_PATH=$(echo "$line" | cut -d: -f1)
  ALLOWED=0
  for a in "${ALLOWLIST[@]}"; do
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
  echo "Allowlisted occurrences (Phase 3 SVC-02 must remove these):"
  echo "$MATCHES"
  exit 0
fi

echo ""
echo "lint-no-revalidate-max: FAIL"
echo ""
echo "The revalidateTag(..., 'max') anti-pattern was found in non-allowlisted files:"
echo ""
echo "$NON_ALLOWLISTED"
echo ""
echo "CONCERNS.md flags this as a MEDIUM-severity bug. Fix by dropping the 2nd arg:"
echo "  revalidateTag(DASHBOARD_CACHE_TAG)              # correct"
echo "  revalidateTag(DASHBOARD_CACHE_TAG, \"max\")       # WRONG — bogus 2nd arg"
echo ""
echo "Phase 3 SVC-02 will remove the one allowlisted occurrence in service.ts."
echo "New code paths MUST NOT reintroduce this pattern."
echo "See .planning/phases/02-data-layer/02-09-SUMMARY.md for the deferral rationale."
exit 1
