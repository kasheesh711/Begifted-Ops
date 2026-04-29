#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Phase 1 (Wisenet Discovery) Validator
# -----------------------------------------------------------------------------
# POSIX-compatible bash (no bash-4-only features; macOS default is bash 3.2).
#
# Invocation:
#   bash validate-phase1.sh         # full run (includes jq assertions)
#   bash validate-phase1.sh --quick # skip jq-dependent assertions
#
# Exit codes:
#   0 -> all assertions passed (or legitimately SKIPped because target file
#        did not exist yet in the current wave)
#   1 -> one or more assertions FAILed
#   >=2 -> script bug / shell error
#
# Wave-tolerance: During Waves 1-3 many target files under
# `.planning/research/` legitimately do not exist yet. Those assertions emit
# `SKIP:` rather than `FAIL:` so the validator stays green while the phase
# progresses. Only when the target file is present AND the content check
# fails is it a FAIL.
# -----------------------------------------------------------------------------

set -eu

QUICK=0
if [ "${1-}" = "--quick" ]; then
  QUICK=1
fi

# Resolve the repo root relative to this script so assertions work regardless
# of the caller's CWD. This script lives at
# `.planning/phases/01-wisenet-discovery/validate-phase1.sh`, so the repo
# root is three directories up.
PHASE_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

FAIL_COUNT=0
PASS_COUNT=0
SKIP_COUNT=0

_pass() {
  echo "OK: $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

_fail() {
  echo "FAIL: $1 — $2"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

_skip() {
  echo "SKIP: $1 ($2)"
  SKIP_COUNT=$((SKIP_COUNT + 1))
}

_warn() {
  echo "WARN: $1 — $2"
}

# -----------------------------------------------------------------------------
# Assertion: WISENET_FIELD_MAP.md exists
# -----------------------------------------------------------------------------
assert_field_map_exists() {
  local f="$PHASE_ROOT/.planning/research/WISENET_FIELD_MAP.md"
  if [ -f "$f" ]; then
    _pass "field_map_exists — $f present"
  else
    _skip "field_map_exists" "file not yet created"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: WISENET_ENDPOINTS.md exists
# -----------------------------------------------------------------------------
assert_endpoints_exists() {
  local f="$PHASE_ROOT/.planning/research/WISENET_ENDPOINTS.md"
  if [ -f "$f" ]; then
    _pass "endpoints_exists — $f present"
  else
    _skip "endpoints_exists" "file not yet created"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: Six required field-map sections are present
# -----------------------------------------------------------------------------
assert_field_map_has_six_sections() {
  local f="$PHASE_ROOT/.planning/research/WISENET_FIELD_MAP.md"
  if [ ! -f "$f" ]; then
    _skip "field_map_has_six_sections" "field map not yet created"
    return
  fi
  local sections="Aggregations Credit_Control Upcoming_Sessions Students Students_and_Courses RemainingCredits"
  # The tab titles contain spaces; use literal heading matchers.
  local missing=0
  for heading in \
    "^## Aggregations$" \
    "^## Credit_Control$" \
    "^## Upcoming Sessions$" \
    "^## Students$" \
    "^## Students & Courses$" \
    "^## RemainingCredits$"; do
    if ! grep -qE "$heading" "$f"; then
      missing=$((missing + 1))
    fi
  done
  if [ "$missing" = "0" ]; then
    _pass "field_map_has_six_sections — all 6 tab headings present"
  else
    _fail "field_map_has_six_sections" "$missing of 6 expected tab headings missing"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: All 25 REQUIRED_COLUMNS field names appear in the field map
#
# Sanity check: verifies each of the 25 field-name strings appears as a
# pipe-delimited row at least once. This is NECESSARY BUT NOT SUFFICIENT —
# "Student Name" appears in four tabs, so one occurrence of it does not
# prove all four tabs are complete. The binding check is
# assert_per_tab_row_counts below.
# -----------------------------------------------------------------------------
assert_all_25_required_columns_present() {
  local f="$PHASE_ROOT/.planning/research/WISENET_FIELD_MAP.md"
  if [ ! -f "$f" ]; then
    _skip "all_25_required_columns_present" "field map not yet created"
    return
  fi

  # Hardcoded from web/src/lib/dashboard/config.ts REQUIRED_COLUMNS.
  # Order preserves grouping: aggregations(5) + creditControl(8) + upcoming(5)
  # + students(2) + studentsCourses(3) + remainingCredits(2) = 25 rows.
  # Student Name, Package/Program, Class Subject appear in multiple tabs —
  # we count occurrences only as a "present at all" sanity check here.
  local fields="
Student Name
Parent Name
Class Subject
Current Remaining Credits
Current Total Credits
Package/Program
final_status
teacher_feedback
credits_consumed
session_duration
session_date
Should_Credit
Session Status
Session Duration
Scheduled Date
student_name
Remaining Credits
Class Name
Student
Admin
"
  local missing=0
  local miss_list=""
  # Use a while-read loop instead of IFS tricks so field names with spaces
  # survive intact.
  while IFS= read -r field; do
    if [ -z "$field" ]; then continue; fi
    # Match pipe-delimited row containing the field name as the first or
    # similar column. Accept either "| Field |" or "| Field " prefix.
    if ! grep -qF "| $field |" "$f" 2>/dev/null \
       && ! grep -qF "|$field|" "$f" 2>/dev/null; then
      missing=$((missing + 1))
      miss_list="$miss_list [$field]"
    fi
  done <<EOF
$fields
EOF

  if [ "$missing" = "0" ]; then
    _pass "all_25_required_columns_present — every REQUIRED_COLUMNS field name has ≥1 matrix row"
  else
    _fail "all_25_required_columns_present" "$missing field(s) missing a matrix row:$miss_list"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: Per-tab row counts (binding per-tab check, closes B-2 gap)
#
# For each of the 6 `## <Tab>` sections, count pipe-delimited data rows and
# compare against the canonical REQUIRED_COLUMNS counts (5, 8, 5, 2, 3, 2).
# Separator rows (--- | --- | ...) and header rows (containing "Dashboard
# Field") are excluded from the count.
# -----------------------------------------------------------------------------
assert_per_tab_row_counts() {
  local map_file="$PHASE_ROOT/.planning/research/WISENET_FIELD_MAP.md"
  if [ ! -f "$map_file" ]; then
    _skip "per_tab_row_counts" "field map not yet created"
    return
  fi

  # Expected counts from web/src/lib/dashboard/config.ts REQUIRED_COLUMNS
  local expected_aggregations=5
  local expected_credit_control=8
  local expected_upcoming=5
  local expected_students=2
  local expected_students_courses=3
  local expected_remaining_credits=2

  # awk helper: walk from the `## <section>` heading to the next `## `
  # heading, counting pipe-delimited rows that are NOT the header row or
  # the separator row.
  _count_rows_in_section() {
    local section_name="$1"
    awk -v section="$section_name" '
      $0 ~ "^## " section "$" { in_section = 1; next }
      in_section && /^## / { in_section = 0 }
      in_section && /^\|/ {
        # skip separator row (only dashes/colons/pipes/spaces)
        if ($0 ~ /^\|[-:| ]+\|?[[:space:]]*$/) next
        # skip header row (template mandates "Dashboard Field" as column 1)
        if ($0 ~ /Dashboard Field/) next
        count++
      }
      END { print count + 0 }
    ' "$map_file"
  }

  local fail_local=0
  local msg=""
  for pair in \
    "Aggregations:$expected_aggregations" \
    "Credit_Control:$expected_credit_control" \
    "Upcoming Sessions:$expected_upcoming" \
    "Students:$expected_students" \
    "Students & Courses:$expected_students_courses" \
    "RemainingCredits:$expected_remaining_credits"; do
    local section="${pair%:*}"
    local expected="${pair#*:}"
    local actual
    actual="$(_count_rows_in_section "$section")"
    if [ "$actual" != "$expected" ]; then
      msg="$msg [$section: got $actual, expected $expected]"
      fail_local=1
    fi
  done

  if [ "$fail_local" = "0" ]; then
    _pass "per_tab_row_counts — all 6 tabs have exact expected row counts (5+8+5+2+3+2=25)"
  else
    _fail "per_tab_row_counts" "one or more sections have the wrong row count:$msg"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: Every non-header row is classified GREEN / YELLOW / RED
# -----------------------------------------------------------------------------
assert_every_row_classified_green_yellow_red() {
  local f="$PHASE_ROOT/.planning/research/WISENET_FIELD_MAP.md"
  if [ ! -f "$f" ]; then
    _skip "every_row_classified_green_yellow_red" "field map not yet created"
    return
  fi

  # Extract column 6 (classification) from every pipe row. Skip blank/header/
  # separator rows. Anything other than GREEN|YELLOW|RED is a failure.
  local bad
  bad="$(
    awk -F'|' '
      /^\|/ {
        # Skip separator rows
        if ($0 ~ /^\|[-:| ]+\|?[[:space:]]*$/) next
        # Skip header rows
        if ($0 ~ /Dashboard Field/) next
        # Trim column 6 whitespace
        val = $6
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
        if (val == "" || val == "classification") next
        if (val != "GREEN" && val != "YELLOW" && val != "RED") {
          print val
        }
      }
    ' "$f"
  )"

  if [ -z "$bad" ]; then
    _pass "every_row_classified_green_yellow_red — every data row has a GREEN/YELLOW/RED classification"
  else
    local count
    count="$(printf '%s\n' "$bad" | wc -l | tr -d ' ')"
    _fail "every_row_classified_green_yellow_red" "$count row(s) have a classification that is not GREEN/YELLOW/RED"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: Every non-header row cites Postman: or Fixture: in the notes col
# -----------------------------------------------------------------------------
assert_every_row_cites_postman_or_fixture() {
  local f="$PHASE_ROOT/.planning/research/WISENET_FIELD_MAP.md"
  if [ ! -f "$f" ]; then
    _skip "every_row_cites_postman_or_fixture" "field map not yet created"
    return
  fi

  # Column 8 is the notes column. Assert every data row has Postman: or Fixture:
  local offenders
  offenders="$(
    awk -F'|' '
      /^\|/ {
        if ($0 ~ /^\|[-:| ]+\|?[[:space:]]*$/) next
        if ($0 ~ /Dashboard Field/) next
        notes = $8
        if (notes !~ /Postman:/ && notes !~ /Fixture:/) {
          print NR
        }
      }
    ' "$f"
  )"

  if [ -z "$offenders" ]; then
    _pass "every_row_cites_postman_or_fixture — every data row cites Postman: or Fixture: evidence"
  else
    local count
    count="$(printf '%s\n' "$offenders" | wc -l | tr -d ' ')"
    _fail "every_row_cites_postman_or_fixture" "$count data row(s) missing Postman:/Fixture: citation"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: RED rows have structured 5-marker decision blocks
# -----------------------------------------------------------------------------
assert_red_rows_have_structured_blocks() {
  local f="$PHASE_ROOT/.planning/research/WISENET_FIELD_MAP.md"
  if [ ! -f "$f" ]; then
    _skip "red_rows_have_structured_blocks" "field map not yet created"
    return
  fi

  # Count RED rows (classification column == RED)
  local red_rows
  red_rows="$(
    awk -F'|' '
      /^\|/ {
        if ($0 ~ /^\|[-:| ]+\|?[[:space:]]*$/) next
        if ($0 ~ /Dashboard Field/) next
        val = $6
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
        if (val == "RED") count++
      }
      END { print count + 0 }
    ' "$f"
  )"

  # Count fully-structured blocks — a block is any section containing all
  # five markers. Conservative heuristic: count how many times all five
  # markers appear together. We approximate by counting the minimum number
  # of occurrences of each marker and taking the floor.
  local c_problem c_options c_decision c_rationale c_affects
  # Plan prescribes colon-inside-bold: `**Problem:**` etc. Accept both colon-inside and colon-outside forms.
  # Use `|| true` not `|| echo 0`: grep -c always prints a count (even "0") to stdout before exiting 1
  # on zero matches — `|| echo 0` then duplicates the "0" → "0\n0" breaks `[` integer comparison.
  c_problem="$(grep -cE '\*\*Problem:?\*\*' "$f" 2>/dev/null || true)"
  c_options="$(grep -cE '\*\*Options considered:?\*\*' "$f" 2>/dev/null || true)"
  c_decision="$(grep -cE '\*\*Decision:?\*\*' "$f" 2>/dev/null || true)"
  c_rationale="$(grep -cE '\*\*Rationale:?\*\*' "$f" 2>/dev/null || true)"
  c_affects="$(grep -cE '\*\*Affects:?\*\*' "$f" 2>/dev/null || true)"

  # min across all five counts
  local min_blocks=$c_problem
  [ "$c_options" -lt "$min_blocks" ] && min_blocks=$c_options
  [ "$c_decision" -lt "$min_blocks" ] && min_blocks=$c_decision
  [ "$c_rationale" -lt "$min_blocks" ] && min_blocks=$c_rationale
  [ "$c_affects" -lt "$min_blocks" ] && min_blocks=$c_affects

  if [ "$red_rows" = "0" ]; then
    _pass "red_rows_have_structured_blocks — 0 RED rows in field map (nothing to check)"
  elif [ "$min_blocks" = "$red_rows" ]; then
    _pass "red_rows_have_structured_blocks — $red_rows RED rows, $min_blocks structured blocks"
  else
    _fail "red_rows_have_structured_blocks" "$red_rows RED rows but only $min_blocks fully-structured blocks (need all 5 markers per RED row)"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: RED row decisions use the allowlist (derive-client / accept-loss
# / postgres-sidecar / block-cutover)
# -----------------------------------------------------------------------------
assert_red_decision_allowlist() {
  local f="$PHASE_ROOT/.planning/research/WISENET_FIELD_MAP.md"
  if [ ! -f "$f" ]; then
    _skip "red_decision_allowlist" "field map not yet created"
    return
  fi

  local red_rows
  red_rows="$(
    awk -F'|' '
      /^\|/ {
        if ($0 ~ /^\|[-:| ]+\|?[[:space:]]*$/) next
        if ($0 ~ /Dashboard Field/) next
        val = $6
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
        if (val == "RED") count++
      }
      END { print count + 0 }
    ' "$f"
  )"

  local allowed_decisions
  allowed_decisions="$(
    grep -oE '\*\*Decision:?\*\*:?[[:space:]]*(derive-client|accept-loss|postgres-sidecar|block-cutover)' "$f" 2>/dev/null | wc -l | tr -d ' '
  )"

  if [ "$red_rows" = "0" ]; then
    _pass "red_decision_allowlist — 0 RED rows (nothing to check)"
  elif [ "$allowed_decisions" = "$red_rows" ]; then
    _pass "red_decision_allowlist — $red_rows RED rows, each with one allowed decision"
  else
    _fail "red_decision_allowlist" "$red_rows RED rows but $allowed_decisions allow-listed decisions (every RED row needs exactly one of derive-client|accept-loss|postgres-sidecar|block-cutover)"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: WISENET_ENDPOINTS.md has an ## Auth section with Type + Header name
# -----------------------------------------------------------------------------
assert_endpoints_has_auth_section() {
  local f="$PHASE_ROOT/.planning/research/WISENET_ENDPOINTS.md"
  if [ ! -f "$f" ]; then
    _skip "endpoints_has_auth_section" "endpoints file not yet created"
    return
  fi

  if ! grep -qE '^## Auth' "$f"; then
    _fail "endpoints_has_auth_section" "no '## Auth' heading found"
    return
  fi

  # Slice from the `## Auth` heading up to (but not including) the NEXT
  # top-level `## ` heading. Previous regex (`/^## [A-Z]/`) matched the Auth
  # heading itself when it started with an uppercase letter, closing the awk
  # range on the same line and yielding only the heading. We instead flip an
  # `in_auth` flag and stop when we see a different `^## ` line.
  local slice
  slice="$(
    awk '
      /^## Auth/ { in_auth = 1; next }
      in_auth && /^## / { exit }
      in_auth { print }
    ' "$f"
  )"
  local has_type=0
  local has_header=0
  if printf '%s' "$slice" | grep -qE 'Type:'; then has_type=1; fi
  if printf '%s' "$slice" | grep -qE 'Header name:'; then has_header=1; fi

  if [ "$has_type" = "1" ] && [ "$has_header" = "1" ]; then
    _pass "endpoints_has_auth_section — ## Auth contains Type: and Header name:"
  else
    _fail "endpoints_has_auth_section" "## Auth missing Type: ($has_type) or Header name: ($has_header)"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: WISENET_ENDPOINTS.md documents a concrete baseUrl (not a
# `{{baseUrl}}` placeholder)
# -----------------------------------------------------------------------------
assert_endpoints_has_base_url() {
  local f="$PHASE_ROOT/.planning/research/WISENET_ENDPOINTS.md"
  if [ ! -f "$f" ]; then
    _skip "endpoints_has_base_url" "endpoints file not yet created"
    return
  fi

  if grep -qE 'baseUrl.*=.*https?://' "$f" 2>/dev/null; then
    _pass "endpoints_has_base_url — concrete https?:// baseUrl documented"
  else
    _fail "endpoints_has_base_url" "no baseUrl = http(s)://... line found (placeholder still in place?)"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: rate-limit fingerprint fixture has required keys (full run only)
# -----------------------------------------------------------------------------
assert_rate_limit_fingerprint_valid() {
  if [ "$QUICK" = "1" ]; then
    _skip "rate_limit_fingerprint_valid" "skipped in --quick mode (requires jq)"
    return
  fi
  local f="$PHASE_ROOT/.planning/research/fixtures/wisenet/_rate-limit-fingerprint.json"
  if [ ! -f "$f" ]; then
    _skip "rate_limit_fingerprint_valid" "fingerprint fixture not yet created"
    return
  fi
  if ! command -v jq >/dev/null 2>&1; then
    _skip "rate_limit_fingerprint_valid" "jq not installed"
    return
  fi
  # The fingerprint must record either a 429 capture (first_429_headers non-null) OR
  # an explicit no_429_observed=true flag when the 200-burst completes without tripping a limit.
  # Wave-0 assertion was stricter (required first_429_headers to always be present); Plan 01-03
  # execution (2026-04-21) recorded a no-429 fingerprint — validator relaxed to accept both
  # outcomes while still asserting burst_size + endpoint shape are present.
  if jq -e '(.first_429_headers != null or .no_429_observed == true) and .burst_size and .endpoint' "$f" >/dev/null 2>&1; then
    _pass "rate_limit_fingerprint_valid — fingerprint has burst_size + endpoint + (429 or no_429 signal)"
  else
    _fail "rate_limit_fingerprint_valid" "fingerprint missing burst_size / endpoint / 429 capture / no_429_observed flag"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: pagination fingerprint fixture has required keys (full run only)
# -----------------------------------------------------------------------------
assert_pagination_fingerprint_valid() {
  if [ "$QUICK" = "1" ]; then
    _skip "pagination_fingerprint_valid" "skipped in --quick mode (requires jq)"
    return
  fi
  local f="$PHASE_ROOT/.planning/research/fixtures/wisenet/_pagination-fingerprint.json"
  if [ ! -f "$f" ]; then
    _skip "pagination_fingerprint_valid" "pagination fingerprint not yet created"
    return
  fi
  if ! command -v jq >/dev/null 2>&1; then
    _skip "pagination_fingerprint_valid" "jq not installed"
    return
  fi
  if jq -e '.pattern and .request_shape and .response_shape' "$f" >/dev/null 2>&1; then
    _pass "pagination_fingerprint_valid — fingerprint has pattern, request_shape, response_shape"
  else
    _fail "pagination_fingerprint_valid" "fingerprint missing pattern / request_shape / response_shape keys"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: the 4 gap questions each have a dedicated answer section
# -----------------------------------------------------------------------------
assert_four_gap_questions_answered() {
  local f="$PHASE_ROOT/.planning/research/WISENET_FIELD_MAP.md"
  if [ ! -f "$f" ]; then
    _skip "four_gap_questions_answered" "field map not yet created"
    return
  fi
  local count
  count="$(grep -cE '^### (Should_Credit|Admin ownership|Credit[.-]balance model|Pending[.-]deduction rule)' "$f" 2>/dev/null || echo 0)"
  if [ "$count" = "4" ]; then
    _pass "four_gap_questions_answered — all 4 gap-question answer sections present"
  else
    _fail "four_gap_questions_answered" "expected 4 '### ...' answer sections for the 4 gap questions, found $count"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: no high-entropy secret-like strings in tracked research files
#
# Scans `.planning/research/` and any `web/scripts/wisenet-*.ts` for strings
# of length >=24 made of [A-Za-z0-9_-]. Filters against a known-non-secret
# allowlist (commit SHAs, Wisenet doc URLs). Emits WARN (not FAIL) so Kevin
# can eyeball the results per VALIDATION.md manual-check list.
# -----------------------------------------------------------------------------
assert_no_secret_like_strings_in_tracked_research() {
  local research_dir="$PHASE_ROOT/.planning/research"
  local probes_glob="$PHASE_ROOT/web/scripts/wisenet-*.ts"

  if [ ! -d "$research_dir" ]; then
    _skip "no_secret_like_strings_in_tracked_research" "research dir does not exist"
    return
  fi

  # Allowlist patterns — these long strings are known non-secret.
  # Add more patterns here as they come up (commit SHAs, public URLs).
  local allowlist='(wisenet\.co|github\.com|vercel\.com|googleapis\.com|begifted-education)'

  # Capture file:line for any high-entropy match NOT on the allowlist.
  # Print path + line number only (never echo the matched string back —
  # keeps potential secrets out of stdout per T-1-02 mitigation).
  local hits
  hits="$(
    {
      grep -rEn '[A-Za-z0-9_-]{24,}' "$research_dir" 2>/dev/null || true
      for f in $probes_glob; do
        if [ -f "$f" ]; then
          grep -En '[A-Za-z0-9_-]{24,}' "$f" 2>/dev/null | sed "s|^|$f:|" || true
        fi
      done
    } | grep -vE "$allowlist" | awk -F: '{ if (NF >= 2) print $1 ":" $2 }'
  )"

  if [ -z "$hits" ]; then
    _pass "no_secret_like_strings_in_tracked_research — no high-entropy strings found"
  else
    local hit_count
    hit_count="$(printf '%s\n' "$hits" | wc -l | tr -d ' ')"
    _warn "no_secret_like_strings_in_tracked_research" "$hit_count high-entropy match(es) found — eyeball review required"
  fi
}

# -----------------------------------------------------------------------------
# Assertion: no real email addresses in fixtures (excluding synthetic
# placeholder domains like @example.test / @example.com)
# -----------------------------------------------------------------------------
assert_fixtures_no_real_emails() {
  local fdir="$PHASE_ROOT/.planning/research/fixtures/wisenet"
  if [ ! -d "$fdir" ]; then
    _skip "fixtures_no_real_emails" "fixtures dir does not exist"
    return
  fi

  # Count emails matching the general regex, minus synthetic-domain matches.
  local total
  total="$(grep -rEo '[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' "$fdir" 2>/dev/null | wc -l | tr -d ' ')"
  local synthetic
  synthetic="$(grep -rEo '[a-zA-Z0-9._-]+@(example\.test|example\.com|test\.local)' "$fdir" 2>/dev/null | wc -l | tr -d ' ')"

  local real=$((total - synthetic))
  if [ "$real" -le "0" ]; then
    _pass "fixtures_no_real_emails — 0 non-synthetic emails in fixtures"
  else
    # Do not echo the matched email back — print counts only (T-2-01 mitigation).
    _fail "fixtures_no_real_emails" "$real non-synthetic email(s) detected in fixtures (review the fixture files manually)"
  fi
}

# -----------------------------------------------------------------------------
# Run all assertions
# -----------------------------------------------------------------------------
echo "Phase 1 validator — mode: $([ "$QUICK" = "1" ] && echo quick || echo full)"
echo "Repo root: $PHASE_ROOT"
echo "---"

assert_field_map_exists
assert_endpoints_exists
assert_field_map_has_six_sections
assert_all_25_required_columns_present
assert_per_tab_row_counts
assert_every_row_classified_green_yellow_red
assert_every_row_cites_postman_or_fixture
assert_red_rows_have_structured_blocks
assert_red_decision_allowlist
assert_endpoints_has_auth_section
assert_endpoints_has_base_url
assert_rate_limit_fingerprint_valid
assert_pagination_fingerprint_valid
assert_four_gap_questions_answered
assert_no_secret_like_strings_in_tracked_research
assert_fixtures_no_real_emails

echo "---"
TOTAL=$((PASS_COUNT + FAIL_COUNT + SKIP_COUNT))
echo "Phase 1 validator: $PASS_COUNT passed, $FAIL_COUNT failed, $SKIP_COUNT skipped (total $TOTAL)"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
