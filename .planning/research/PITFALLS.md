# Pitfalls Research

**Domain:** Next.js 16 dashboard migration — Google Sheets -> Wisenet REST API + Neon Postgres, with legacy Apps Script retirement, on Vercel Fluid Compute, WITHOUT a shadow-compare / parity safety net
**Researched:** 2026-04-20
**Confidence:** HIGH on repo-specific facts (drawn from `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/INTEGRATIONS.md`, `.planning/codebase/TESTING.md`, `CLAUDE.md`) · MEDIUM on platform/third-party behaviors (Vercel Fluid Compute, Neon pooling, Wisenet specifics) — verified with 2026-02-27 Vercel knowledge update and Next.js 16 defaults documented in-repo; Wisenet API behavior is explicitly unverified per `PROJECT.md` and flagged as a Phase 1 investigation.

**Constraint treated as first-class: no parity safety net.** Normally `compare-live.ts` or a nightly diff catches silent drift. With that disabled, every pitfall below gets an additional test / sign-off requirement in place of the missing diff.

---

## Critical Pitfalls

### Pitfall 1: Wisenet field-gap discovered after UI cutover

**What goes wrong:**
Operators flip to the new stack and the Student Detail panel is missing `Current Remaining Credits`, or `Should Credit`, or admin ownership, or `expiry` dates that the Aggregations / RemainingCredits / Credit_Control tabs supplied. The dashboard renders but is silently wrong — priority scoring, `ALERT_THRESHOLD = 2`, and `NOTIFY_WINDOW_DAYS = 30` now evaluate against a partial field set. The legacy system is already retired, so there is no one-click rollback.

**Why it happens:**
Per `.planning/PROJECT.md` line 66 and line 81, Wisenet field coverage vs. the current Sheets-driven dashboard is **not yet confirmed**. The existing code (`web/src/lib/dashboard/config.ts:15-102`) hard-codes `REQUIRED_COLUMNS` from six sheet tabs. A Wisenet endpoint that returns "everything about a student" is almost never shaped like six spreadsheet tabs. Fields like "Pending Feedback", "Pending Deduction", "Should Credit", "Consumed Credits", and the "Admin Owner" free-text column are BeGifted-specific accretions on top of a generic student record — Wisenet likely does not ship these natively.

**How to avoid:**
- **Phase 1 deliverable is a field-map matrix**, not a Wisenet client. One row per `REQUIRED_COLUMNS` entry (`config.ts:15-102`), one column per Wisenet endpoint/field. Every cell is GREEN (direct match), YELLOW (derivable/compute-from), or RED (gap).
- RED cells become explicit decisions before Phase 2: accept loss, derive from Postgres sidecar, ask Wisenet support for a custom field, or freeze that dashboard surface area.
- Write the matrix to `.planning/research/WISENET_FIELD_MAP.md` (persisted artifact, not a throwaway).
- Validate the map by implementing **one** read-only endpoint end-to-end (e.g. `/api/wisenet/student/:id`) and diffing its JSON by hand against the current Sheets-driven row for 5 real students. This is the minimum "parity sample" that replaces the missing `compare-live`.

**Warning signs:**
- Phase 1 produces a client before a field map — escalate.
- "We'll figure out admin ownership later" — escalate.
- Dashboard renders a student with `null` in a field the legacy UI would have populated — escalate.
- Anyone says "Wisenet doesn't have this field, we'll compute it" without writing down the derivation — escalate.

**Phase to address:** Phase 1 (Wisenet field discovery & mapping). Gate Phase 2 on matrix completion.

**Severity WITHOUT safety net:** CRITICAL. A nightly diff job would catch a missing field on day 1 with row-level detail. Without one, operator trust erodes silently and the miss is found weeks later via "why does this student's priority look wrong."

---

### Pitfall 2: Silent type coercion in Wisenet responses

**What goes wrong:**
Wisenet returns `"0"` where the dashboard expected `0`, or `"2.5"` where it expected `2.5`, or `"true"` where it expected `true`. Comparisons like `credits < ALERT_THRESHOLD` evaluate as string-vs-number, `"0" < 2` is actually `true` in JS (lucky) but `"10" < 2` is `false` (lucky again) while `"1" < 2` is `true` — until `"10"` gets compared against a number threshold of `"20"` lexicographically somewhere down the pipe and a student sorts wrong. Priority scoring in `web/src/lib/dashboard/analytics.ts` breaks silently.

**Why it happens:**
REST APIs (especially PHP/Rails-backed ones like most student-management vendors) often stringify numbers to preserve precision, and `true/false` flags arrive as `"1"/"0"` or `"Y"/"N"`. The existing Sheets path goes through `googleapis` which coerces via `valueRenderOption: "UNFORMATTED_VALUE"`; the team has never had to manually type-coerce. `dashboard-logic.test.ts` (207 lines) uses inline fixtures authored by humans who write `2`, not `"2"`, so tests pass while production breaks.

**How to avoid:**
- Single Wisenet response parser with **runtime schema validation** (Zod or Valibot) — not TypeScript-only types. TS types lie; Zod throws. Fail fast with actionable errors.
- `z.coerce.number()` for every numeric field, `z.coerce.boolean()` with explicit `"Y"/"N"/"1"/"0"/"true"/"false"` mapping, `z.coerce.date()` for dates (see Pitfall 3 for timezone caveat).
- One canonical `WisenetStudent` -> internal `DashboardStudent` mapping function with unit tests covering **every** type shape seen in 5+ real responses.
- Port the 41 `Validation.gs` test bodies (esp. `testAlertThresholdBoundaryAtExactlyTwoCredits`, `testPendingFeedbackCreatesPendingDeduction`, `testPendingDeductionUsesShouldCreditWhenAvailable`) into `web/src/test/` — these are the behavioral spec, and they currently live in a file that will be deleted.

**Warning signs:**
- Any comparison like `if (value < N)` where `value` came from a fetch without going through a typed parser.
- `toFixed()` being called "just in case" — that's a symptom of coercion debt.
- Test data uses number literals only and never the string form.

**Phase to address:** Phase 2 (Wisenet client + schema). Ported Validation.gs assertions should land in Phase 2 alongside the schema so the cutover ships with pre-day-one regression coverage.

**Severity WITHOUT safety net:** CRITICAL. A shadow-compare would catch `2 !== "2"` in a diff immediately. Without it, this is the single most likely way a "it all looks green" cutover silently corrupts priority scoring.

---

### Pitfall 3: Timezone mismatches in date fields

**What goes wrong:**
Wisenet is Australian, `namespace: "begifted-education"` per `PROJECT.md:64`. Australian systems default to AEST/AEDT (UTC+10/+11). Vercel runs in whatever region is closest (often `syd1` for AU, but could be `iad1`). Node's `new Date("2026-04-20")` parses as UTC midnight; `new Date("2026-04-20T00:00:00")` parses as LOCAL midnight. The dashboard's `NOTIFY_WINDOW_DAYS = 30` window, the "today" concept in `sanitizeStudentActionState` (`testOnlySurfacesSameDayActionState`), and the calendar day grouping (`testCalendarGroupsStudentSessionsByDay`) are all timezone-sensitive. A package that expires on `2026-04-21` Sydney time could show as "expires today" or "expires tomorrow" depending on how the string is parsed on the server, AND differently again in the browser.

**Why it happens:**
Three clocks in play: (1) Wisenet's server TZ (likely AEST), (2) Vercel function TZ (UTC by default, but `TZ` env var overrides), (3) operator browser TZ (likely AEST for HQ operators, possibly different for remote). Apps Script avoided this by running in the spreadsheet's timezone (set per spreadsheet). Next.js has no implicit timezone; it's all JS `Date` objects which default-stringify with the ambient zone.

**How to avoid:**
- Pick one canonical timezone — `Australia/Sydney` — and pin it everywhere. Set `TZ=Australia/Sydney` in Vercel env vars for the deployed function.
- Use a TZ-aware date library (Temporal polyfill or `date-fns-tz` — NOT raw `Date`). `Temporal` is preferred now that Node 24 is default (per 2026-02-27 knowledge update).
- Parse every Wisenet date through `Temporal.Instant.from(wisenetString).toZonedDateTimeISO('Australia/Sydney')`. Never cross a timezone boundary implicitly.
- Audit: grep for `new Date(` and `.toISOString()` in the new code path; every hit needs a comment explaining which TZ it's operating in.
- Add a test that freezes `Date.now()` to a known UTC timestamp and asserts "today" in Sydney is correct across the 13:00-00:00 UTC boundary (the window where UTC and Sydney are different dates).

**Warning signs:**
- Calendar shows a student session on a different day than the operator expected.
- Same-day action state (`testStudentActionStateOnlySurfacesToday`) appears or disappears around 10am-2pm operator time.
- `NOTIFY_WINDOW_DAYS = 30` window includes or excludes a package that the spreadsheet used to/didn't surface.

**Phase to address:** Phase 2 (Wisenet parsing) and Phase 3 (UI wire-up) — both need the same canonical TZ handling.

**Severity WITHOUT safety net:** HIGH. A parity diff would catch "student X in calendar day Y in old, day Z in new" immediately. Without it, off-by-one-day bugs are the #2 silent-corruption risk after type coercion.

---

### Pitfall 4: Neon connection-pool exhaustion under Fluid Compute scaling

**What goes wrong:**
Under bursty traffic (morning operator login, bulk action on 50 students, cache warm-up), Fluid Compute spawns multiple concurrent function instances. Each instance opens a TCP connection to Neon. Neon's free tier has a ~100-connection ceiling; the Launch plan is higher but still finite. Pool exhaustion manifests as `sorry, too many clients already` thrown inside `/api/actions/bulk` or `/api/dashboard` — 500s at the worst possible moment (bulk write) with partial writes already committed.

**Why it happens:**
Three compounding factors:
1. Vercel Fluid Compute **reuses instances across concurrent requests** (per 2026-02-27 knowledge update) — this is GOOD for connection reuse but ONLY IF the code keeps a single pool per instance. A naive `new Pool()` per request defeats it.
2. Classic `pg.Pool` with `connectionString` opens **direct** TCP connections. Under Fluid Compute autoscaling, N instances × M pooled connections can easily exceed the Neon tier limit.
3. The existing `web/src/lib/sheets/client.ts:4` `cachedClient` pattern is ALREADY per-instance; developers may naively replicate this for pg, forgetting that pg pools hold real sockets.

**How to avoid:**
- **Use Neon's pooled connection string** (ends in `-pooler.<region>.aws.neon.tech`) for all runtime queries. This puts PgBouncer between your function and Postgres; PgBouncer handles the fanout.
- For serverless bursts, **prefer `@neondatabase/serverless` over `pg`** for read queries — it uses HTTP/WebSockets and is connectionless. Use the node `pg` Pool only for transactions.
- Singleton pattern:
  ```ts
  // web/src/lib/db/client.ts
  import { Pool } from "pg";
  const g = globalThis as any;
  export const db = g.__bgPgPool ??= new Pool({
    connectionString: process.env.DATABASE_URL_POOLER,
    max: 3, // not 10+ — Fluid scales instances instead
    idleTimeoutMillis: 10_000,
  });
  ```
- Set `max: 3` per-instance, not the default 10. Fluid Compute scaling means total = instances × max; keep the multiplier small.
- DO NOT use the **unpooled** connection string (no `-pooler` in hostname) for `/api/*` routes. Reserve it for migrations only.
- Add a load test: 50 concurrent `POST /api/actions` and verify no "too many clients" errors. This is the replacement for the missing shadow-compare's accidental load-testing side-effect.

**Warning signs:**
- `pg` client imported but no singleton wrapper visible in `web/src/lib/db/`.
- `DATABASE_URL` env var used instead of `DATABASE_URL_POOLER` in route handlers.
- `new Pool()` inside a route handler body (not module-scope).
- Bulk action of >20 students hangs or 500s — first suspect is connection starvation, not SQL.

**Phase to address:** Phase 2 (Postgres setup for follow-up state). Add a connection-pool smoke test in the same PR that adds the pool.

**Severity WITHOUT safety net:** HIGH. A bad pool config can bring production down completely, and Neon doesn't queue — it drops. No shadow fallback means operator workflow halts until hotfix.

---

### Pitfall 5: Chunk-transfer / HTTP -1 regression reappears under Next.js streaming

**What goes wrong:**
The team KNOWS `HTTP -1` / chunk-transfer errors as a recurring pattern (`CLAUDE.md` explicit rule; `CONCERNS.md` Known Incident Patterns HIGH). The Apps Script cause was stale clasp deployments (`Code.gs:159-235` recovery branches). After cutover, the team assumes the category is "retired." It is not — Next.js 16 App Router, Fluid Compute, streaming responses, and `unstable_cache` can all produce truncated/chunked responses under pressure (cold start + large payload + client abort = partial transfer).

**Why it happens:**
- `/api/dashboard` currently returns a potentially large payload (full student queue). Under Fluid Compute, the function CAN stream, and Next 16 defaults to streaming for RSC payloads. A large response + cold start + Vercel's 25s sync-response limit (before Fluid) or 300s fluid limit + client disconnect = partial response.
- The existing `unstable_cache` call with `revalidateTag(DASHBOARD_CACHE_TAG, "max")` (`web/src/lib/dashboard/service.ts:20`) has an unverified second argument (`CONCERNS.md` MEDIUM). If invalidation silently no-ops, the client sees stale data that it's told is fresh; UI state resync logic may interpret this as an incomplete/corrupted transfer and retry, amplifying load.
- `web/src/lib/cache/memory-cache.ts` is process-local (15s TTL). `snapshot-store.ts` and `health-state.ts` are in-memory module-global `let`s (`CONCERNS.md` Fragile Areas MEDIUM). These work accidentally in Apps Script because there's one long-lived V8 engine per user; on Vercel Fluid Compute there are many, and reuse is an optimization, not a guarantee.

**How to avoid:**
- **Keep `/api/dashboard` synchronous JSON, not streaming RSC.** An explicit `new Response(JSON.stringify(payload))` with `Content-Length` header defeats chunked transfer. Do NOT return a stream from this endpoint.
- Set `export const dynamic = "force-dynamic"` and `export const runtime = "nodejs"` on routes that MUST NOT be streamed/cached by the CDN layer.
- Verify the `revalidateTag` second-argument issue from `CONCERNS.md` — either remove the `"max"` arg if unsupported in `next@16.2.1`, or pin to the Next version that supports it.
- Add a "deployed version" header to every `/api/*` response (`X-BG-Deploy-Id: ${VERCEL_DEPLOYMENT_ID}`) so an incident runbook can confirm which deployment answered — same pattern as the CLAUDE.md rule "treat HTTP -1 as stale-deployment symptoms until deployment version is confirmed," but replacing "clasp version" with "Vercel deployment ID."
- For the dashboard cache invalidation: write the regression test from `CONCERNS.md` Cache Correctness — (1) GET `/api/dashboard`, (2) POST `/api/actions`, (3) GET `/api/dashboard` again, assert updated state.

**Warning signs:**
- Browser shows "Dashboard data unavailable" / partial table after deploy.
- `vercel logs` shows `Request was terminated` or `Function aborted`.
- `X-Vercel-Execution-Duration` header approaches 25-30s (the pre-Fluid hard limit; anything close means you're depending on Fluid's 300s default, which is generous but not free).
- Client-side React error boundary triggered by truncated JSON.

**Phase to address:** Phase 3 (UI wire-up) and Phase 4 (Vercel configuration/deploy). Add the X-Deploy-Id header in the same PR that first changes the response shape.

**Severity WITHOUT safety net:** HIGH — this pattern has bitten this team before, and the institutional muscle memory is "rollback the old deploy." Without the legacy dashboard live, rollback requires a Vercel rollback, which is fine but ONLY IF deploy-history is preserved (see Pitfall 9).

---

### Pitfall 6: next-auth 5 beta minor-version bump breaks sign-in silently

**What goes wrong:**
`next-auth: 5.0.0-beta.30` (`web/package.json:19`). A routine `npm update` or Dependabot PR bumps to `beta.31` / `beta.40`. CSRF handling, session-cookie shape, or redirect-after-signin behavior changes. Operators can't sign in after the merge. The legacy Apps Script dashboard is already retired — there is no fallback URL.

**Why it happens:**
Per `CONCERNS.md` HIGH: `docs/nextjs-shadow-handoff.md:26` already documents one beta-to-beta breakage (`UnknownAction` sign-in error). Betas change. The `signIn` callback, `session` callback, and the custom `/signin` Server Action form (`web/src/app/signin/page.tsx:18-27`) are all surfaces that have changed between betas already.

**How to avoid:**
- **Pin the exact version** with `=5.0.0-beta.30` not `^5.0.0-beta.30`. If already pinned, verify `package-lock.json` agrees.
- Add a Dependabot / Renovate config that EXCLUDES `next-auth` from automatic updates until v5 GA.
- Write an E2E sign-in test (Playwright, one test) that hits `/signin`, submits the Server Action, follows the OAuth redirect (using a test Google account or mock), and asserts the session cookie exists. `CONCERNS.md` Test Coverage Gaps MEDIUM calls this out explicitly. Run it as a post-deploy smoke test on Vercel preview.
- On any deliberate beta bump: bump in a branch, run E2E, deploy to preview, have an operator sign in manually, merge only after green.
- Keep the dev-mode fallback strings (`CONCERNS.md` Auth/Env HIGH `"local-dev-secret"`) but wrap them in `process.env.NODE_ENV !== "production"` so a misconfigured Vercel env fails loudly instead of running with a predictable signing key.

**Warning signs:**
- `next-auth` bump lands in a PR with no auth-specific test changes — block.
- Vercel preview URL returns 500 on `/signin` after a dep update — do not merge.
- Session cookie name changes (`__Secure-next-auth.session-token` vs `authjs.session-token`) — a dead giveaway of a breaking internal change.

**Phase to address:** Phase 4 (deploy hardening). The E2E sign-in test is a hard-blocker for Apps Script retirement (you cannot drop the fallback until auth regression coverage exists).

**Severity WITHOUT safety net:** HIGH — auth failure = 100% of operators locked out. With Apps Script still live, operators could swap URLs. After Phase 5 retirement, they cannot.

---

### Pitfall 7: Switching off Apps Script too early

**What goes wrong:**
The team cuts traffic to Next.js, operators seem fine for 48 hours, so the clasp deployment is stopped and `appsscript.json` access flipped to `MYSELF`. Day 3, a weekly-triggered workflow that was doing something the team forgot about breaks. OR: an operator at a remote center who only opens the dashboard once a week hits the old URL Monday morning and gets a stale/dead page. OR: the `Validation.gs` file (the de facto behavioral spec per `TESTING.md`) is archived before its assertions are ported into Vitest, and a regression ships undetected.

**Why it happens:**
- Apps Script cutover plans underestimate how many workflows touch the system: `.planning/INTEGRATIONS.md` lines 155-161 says "no webhooks, no cron triggers configured," which is reassuring, BUT `DashboardActions.gs` `BG_ACTION_V1::<studentKey>` ScriptProperties are the pre-Sheets action history (`CONCERNS.md` MEDIUM). If ANY operator is still using the legacy URL, their writes go to a store nobody reads.
- `Validation.gs` (2411 lines, 41 tests, `TESTING.md` confirms this is "the de facto spec") is the institutional knowledge. Retiring Apps Script without porting the assertions = losing the spec (`CONCERNS.md` Test Coverage Gaps MEDIUM: "coverage evaporates unless ported first").
- Historical `DashboardActionLog` data (append-only event log) is the audit trail. Retiring the read path without an archive strategy may violate compliance expectations (see Pitfall 11).

**How to avoid:**
- **Retirement is a checklist, not a flag flip:**
  1. Port all 41 `Validation.gs` tests into `web/src/test/` (with name-level parity — `testAlertThresholdBoundaryAtExactlyTwoCredits` in Apps Script = `it("enforces alert threshold boundary at exactly two credits")` in Vitest).
  2. Snapshot the final state of all Apps Script `ScriptProperties` (export via a one-shot `clasp run` to a JSON file) and archive to the analytics spreadsheet or a Blob.
  3. Snapshot the final state of `DashboardActionLog`, `DashboardActionsState`, `InactiveStudents` sheets to CSV; archive. These sheets remain in place per PROJECT.md line 45 but become read-only archive.
  4. Change Apps Script web app to a "Moved" page with a link to the new URL (not "deployed stopped" — that gives `HTTP -1` confusingly). Leave this up for 30 days minimum.
  5. Only AFTER operator sign-off and 30 days of zero traffic on the old URL, flip `access` to `MYSELF` and archive the `.gs` sources in `docs/archive/apps-script-2026-04/`.
- Sequence matters: ports-first, snapshot-second, redirect-third, final-archive-fourth. Compressing this loses work.

**Warning signs:**
- Any PR titled "retire Apps Script" that does NOT include test ports.
- `Validation.gs` deletion in a diff with fewer Vitest assertions added than it removed.
- The legacy URL returning a raw error instead of a "moved" page.
- Operators reporting "my history is gone" (see Pitfall 11).

**Phase to address:** Phase 5 (Apps Script retirement) — but the test-port work starts in Phase 2 and MUST be complete before Phase 5 even begins.

**Severity WITHOUT safety net:** MEDIUM-HIGH. The shadow-compare was never the retirement safety net; it was the cutover safety net. But losing `Validation.gs` assertions without porting them is permanent debt that no amount of future testing can reconstruct (fixtures are the hard part, and the Apps Script ones are battle-tested).

---

### Pitfall 8: Secrets leak — credentials in this chat and elsewhere

**What goes wrong:**
**The user pasted Wisenet credentials into chat this session per the orchestrator's prompt.** That chat transcript may be logged on Anthropic's side. Those specific credentials must be treated as compromised. Separately, the project has several latent secret-leak paths: `.env` at repo root would NOT be caught by `.gitignore` (`CONCERNS.md` MEDIUM: root `.gitignore` does not list `.env`), `web/src/lib/sheets/client.ts:14` has had a DECODER error before (escape handling), and there is no pre-commit or CI secret scanner (`CONCERNS.md` LOW: "no GitHub Actions workflow directory").

**Why it happens:**
- Humans paste creds when chasing a bug ("here's the key, what's wrong"). The Wisenet creds in this migration came from a pasted source.
- `.env` at repo root (outside `web/`) is not covered by `web/.gitignore`. A developer running `echo "WISENET_API_KEY=..." > .env` in the wrong directory commits it silently.
- PR descriptions, commit messages, and deploy logs are all channels where secrets leak. `console.log(process.env.WISENET_API_KEY)` during debugging is a classic.
- Vercel build logs are semi-public within the team; service account JSONs printed during debug appear there.

**How to avoid:**
- **Rotate the Wisenet credentials pasted in chat.** Treat them as known-compromised. Before any production use: regenerate in Wisenet admin, update only in Vercel env vars and `web/.env` (gitignored), never in chat / commits / docs / PRs.
- **Harden root `.gitignore`**: add `.env`, `.env.*`, `*-credentials.json`, `service-account*.json`, `*.pem`, `*.key`, `client_secret_*.json`, and `begifted-ops-*.json` (the service account filename pattern from `CONCERNS.md` Secrets section).
- **Add a secret scanner**: GitHub Actions workflow with `gitleaks` or `trufflehog` running on every PR. Cost: 30 minutes to set up, zero runtime.
- **Never log `process.env` values** in routes, even in dev. Wrap env-access in `getAuthEnv()` / `getSheetsEnv()` / new `getWisenetEnv()` and never let the raw value cross a `console.log` or `Logger.log` boundary.
- **`git log -p`-style review** on the migration PR — `git log --all -p -- '*.env*'` should return nothing.
- Document in `docs/ENV_SETUP.md` that pasting secrets into chat, issues, or commit messages requires rotation of the specific secret.

**Warning signs:**
- Any file named `.env.sample` or `.env.example` with real-looking values instead of placeholders.
- `console.log(env.*)` in any route.
- Vercel deploy log showing a JSON blob that includes a private key.
- `grep -r 'begifted-ops-[a-z0-9]*\.json' .` finds a reference in tracked files.

**Phase to address:** Phase 0 (pre-work, BEFORE any Wisenet client code). This is the first commit: rotate creds, harden `.gitignore`, add secret scanner. Everything else blocks on this.

**Severity WITHOUT safety net:** HIGH. A leaked Wisenet key gives arbitrary read access to all BeGifted student records — a privacy incident, not just an outage.

---

### Pitfall 9: Cold-start Postgres with no historical follow-up state confuses operators

**What goes wrong:**
Day 1 of cutover. An operator opens the Student Detail for "Jade Lim," who they personally called yesterday and marked `contacted`. New dashboard shows "No follow-up history." The operator assumes the migration failed and calls again — duplicating outreach, annoying the parent, and losing trust in the new system. Multiply by 20 operators × 50 students each.

**Why it happens:**
Per `PROJECT.md:45`: "Migrating historical follow-up state from the action sheets into Postgres" is OUT OF SCOPE. Per line 91: "Action sheets remain as archive." That is a product decision — but it only works if operators are told clearly that their history is elsewhere, AND they have a direct link to the archive.

**How to avoid:**
- **UI affordance:** Student Detail panel gets an "Archived history (pre-2026-04)" section with a direct link to the old `DashboardActionLog` sheet filtered to that student. Do not just hide the pre-cutover history — surface the archive.
- **Banner on day 1:** Dashboard-wide banner "Follow-up history starts fresh as of [cutover date]. Prior history is archived at [link]." Dismissible, but logged as dismissed-per-operator.
- **Operator communication before cutover** (not just a changelog) — a 15-min demo of "this is where your old notes are."
- **Cutover date is hard** — pick one, announce it, and do the cutover atomically, not gradually. Gradual cutover with dual-write is explicitly out-of-scope, and dual-READ (old history + new) is an implicit scope-creep risk.

**Warning signs:**
- UI review PR does not show the archive-link affordance.
- Operator handover doc mentions "no history migration" without also mentioning "here's the direct link to old history."
- Support tickets on week 1 of the form "where did X go?"

**Phase to address:** Phase 3 (UI wire-up) — the archive-link affordance is a first-class UI element, not a post-launch followup.

**Severity WITHOUT safety net:** MEDIUM. Recoverable with operator comms, but a poor cutover UX damages operator trust, which directly damages the "single source of truth" core value in `PROJECT.md`.

---

### Pitfall 10: Wisenet rate-limiting and pagination discovered in production

**What goes wrong:**
Dashboard load calls Wisenet for N students, M packages, K sessions. In dev with 10 fixture students, everything's fast. In prod with the real ~hundreds of students, Wisenet returns 429s, or paginates (returns 100 rows + `nextPageToken`), or silently truncates without pagination signal. The dashboard partially renders, or hangs, or shows "everyone has the same 100 students."

**Why it happens:**
Per `PROJECT.md:66`: Wisenet field coverage is unverified. Rate limits and pagination behavior are a SUBSET of that unknown. Most student-management vendors (Wisenet, SISOnline, etc.) have rate limits in the 60-300 req/min range and use cursor- or page-number pagination. Loading a full dashboard naively = one-request-per-student = easy 429.

**How to avoid:**
- **Phase 1 investigation includes rate-limit + pagination fingerprinting.** Make 200 requests to the busiest Wisenet endpoint in quick succession and record: at what rate do 429s appear? what's in the `Retry-After` / `X-RateLimit-*` headers? does pagination use `next_page`, `offset`, `cursor`, or a `Link: rel=next` header?
- **Design for bulk endpoints before loop-per-student.** Wisenet's Postman docs (per PROJECT.md:65) should be read cover-to-cover in Phase 1 to find any "list all students" / "list all packages" endpoint; if there is none, plan a backoff+retry client with `p-limit` concurrency cap at 3-5.
- **Cache aggressively at the read boundary** — but not per-operator. The Neon Postgres can hold a 5-minute-TTL snapshot of Wisenet responses keyed by endpoint URL; the dashboard reads from Postgres, which reads from Wisenet. This inverts the current `unstable_cache` -> Sheets pattern and replaces it with `unstable_cache` -> Postgres -> Wisenet.
- **Server-side pagination, not client-side.** Never return >200 students to the client in one response; if Wisenet's list endpoint returns 1000, paginate server-side before shaping the response.
- **Specific test:** simulate a 429 from Wisenet (via MSW or a local proxy) and assert the client backs off and eventually succeeds, not loops.

**Warning signs:**
- Phase 1 Wisenet investigation produces only a "it works on 5 students" note.
- No `Retry-After` handling in the Wisenet client.
- Any call pattern of the form `students.map(s => fetchWisenet(s.id))` without a concurrency cap.
- Dashboard load time grows linearly with student count (O(n) requests) rather than constant.

**Phase to address:** Phase 1 (investigation) identifies limits; Phase 2 (client) implements backoff/pagination/caching.

**Severity WITHOUT safety net:** HIGH. Rate-limit discovery in prod = visible outage. No shadow to fall back to. The mitigation (Postgres-as-cache-layer) doubles as a reliability net, but only if implemented.

---

### Pitfall 11: Compliance gap from losing the Apps Script audit trail

**What goes wrong:**
`DashboardActionLog` (append-only per `INTEGRATIONS.md:46` and `config.ts:42-52`) is the historical record of "who contacted whom, when." If the system is used for any context where BeGifted is expected to demonstrate "we tried to reach this customer N times," retiring Apps Script without a proper archive snapshot = permanent loss of that record.

**Why it happens:**
Action sheets remain in place as "read-only archive" per `PROJECT.md:45`. But "remain in place" means "the Google Sheet exists" — it does NOT automatically mean:
- The spreadsheet is owned by the right Google Workspace account after the deploying user leaves.
- Service account access persists (the Phase 5 retirement may revoke the service account).
- The analytics spreadsheet ID is documented in a runbook alongside schema notes.
- An operator 18 months from now can locate and read the archive.

**How to avoid:**
- **Phase 5 deliverable includes an "archive manifest":** `docs/ARCHIVE_LOG_2026-04.md` listing every Google Sheet kept as archive, its spreadsheet ID, who owns it, how to grant a new user read access, the schema of each tab, and the date range it covers.
- **Snapshot-to-immutable-storage:** Export `DashboardActionLog`, `DashboardActionsState`, and `InactiveStudents` to CSV and commit to a separate private repo OR Vercel Blob with a retention lock. Google Sheets can be edited; an append-only blob cannot.
- **Retention policy decision:** decide explicitly "we keep X years of action history" and document why. "We don't know" is the wrong answer — even BeGifted Education has duty-of-care expectations with parents that may require 3-7 years of contact history.
- Confirm with Kevin (project owner) whether this is a regulated concern (AU privacy / student records) or purely operational.

**Warning signs:**
- Phase 5 merges and `docs/ARCHIVE_*` does not exist.
- The analytics spreadsheet owner is a personal Google account, not a BeGifted Workspace account.
- No CSV export has been taken of `DashboardActionLog` pre-retirement.

**Phase to address:** Phase 5 (retirement). Confirm requirements in Phase 0.

**Severity WITHOUT safety net:** MEDIUM. Low probability of being asked for 2-year-old action history, but high cost if it happens (privacy complaint, parent dispute). Cheap to mitigate; catastrophic if ignored and needed.

---

### Pitfall 12: `codex/dashboard-load-performance` branch work rebased but partially reintroduced

**What goes wrong:**
`PROJECT.md:46` says rebase/discard the branch. In practice, a developer pulls the branch for reference, copies "one small helpful bit" into the migration branch, and brings along an unnoticed regression or stale assumption. OR: the branch has a legitimate fix (e.g., a `unstable_cache` call-site repair) and discarding it silently reintroduces a bug that was already fixed.

**Why it happens:**
Discard-then-rewrite is clean in theory. In practice, developers salvage. The branch name "dashboard-load-performance" implies it touched `dashboard-shell.tsx` (1013 lines per `CONCERNS.md` MEDIUM), `queue-panel`, `student-detail`, `api/inactive`. The migration rewrites the same surface. Collision is near-certain.

**How to avoid:**
- **Explicitly enumerate what's on the branch.** Before discard, produce a diff summary: "5 files changed, +200/-150 lines, here's what each changes." File in `.planning/NOTES_CODEX_BRANCH.md`.
- **For each change, decide keep/drop explicitly.** Do not let the migration author discover it "by accident" when rebasing.
- **Actual discard plan:** `git branch -D codex/dashboard-load-performance` (local) and `git push origin :codex/dashboard-load-performance` (remote) **after** the migration ships, not before. Keeping the branch alive during migration lets any rediscovery be quick.
- **Do not amend migration commits with branch content.** If something from the branch is worth keeping, cherry-pick it as a separate labeled commit in the migration PR so it's reviewable.

**Warning signs:**
- Migration PR description does not acknowledge the branch.
- Migration diff touches `dashboard-shell.tsx` state-sync code at lines 270-282 (from `CONCERNS.md` MEDIUM) — this is the high-collision zone.
- Anyone says "I think there was a fix for this on the codex branch" and can't find it.

**Phase to address:** Phase 0 (pre-work). Discard is a housekeeping task; documenting what's being discarded is the actual deliverable.

**Severity WITHOUT safety net:** LOW-MEDIUM. Mostly hygiene; reduces "did this bug come from the migration or the discarded branch" debugging cost.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems **given no parity safety net**.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| "We'll port `Validation.gs` tests after cutover" | Ship migration faster | The spec is gone; regressions ship undetected. No `compare-live` to save you. | NEVER — ports BEFORE cutover, always. |
| "Use `DATABASE_URL` directly, pooling is a perf thing" | One fewer env var | Connection-pool exhaustion in prod under real load | NEVER for route handlers; only for migrations |
| "Skip runtime schema validation for Wisenet responses, TypeScript types will protect us" | Less code | Silent type coercion bugs; `"0"` vs `0`; production corruption invisible to tests | NEVER — Zod/Valibot on every external boundary |
| "Handle timezone in the UI, server uses UTC" | One less abstraction | Two timezone bugs (server + client) instead of one. Calendar day drift. | NEVER for this app — AU-centric data |
| "We'll observe in prod, no error tracking for v1" | Zero setup cost | First incident is debugged via `vercel logs` grep, operators fly blind | NEVER for a cutover milestone; add Sentry in Phase 4 |
| "Port the most important 10 of 41 `Validation.gs` tests, rest later" | Faster Phase 2 | Coverage gap in the exact areas you haven't yet re-read in detail | Acceptable IF the 31 un-ported tests are file-listed with "port by Phase 5" tracking |
| "Retire Apps Script in the same PR as the cutover" | Single atomic milestone | Rollback strategy is "revert the PR and redeploy" — works, but you've also lost all legacy context simultaneously | NEVER — keep legacy behind a "moved" page for 30 days minimum |
| "Start with `pg.Pool`, migrate to `@neondatabase/serverless` later" | Familiar API | Already-optimized for serverless queries got missed; pool tuning debt | Acceptable — but `max: 3` from day 1 |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Wisenet API | Trusting field types from first 3 responses | Zod schema per endpoint + coerce; fuzz with 20+ real students |
| Wisenet API | Looping `fetch(per student)` in Node | `p-limit(3)` concurrency cap + `Retry-After` aware backoff |
| Wisenet API | Using the dashboard's `memory-cache.ts` 15s TTL for Wisenet responses | Use Postgres as the cache layer — survives cold starts (solves `snapshot-store.ts` / `health-state.ts` fragility in one go) |
| Neon Postgres | `DATABASE_URL` in route handlers | `DATABASE_URL_POOLER` (ends in `-pooler.<region>.aws.neon.tech`) |
| Neon Postgres | `new Pool()` per request | `globalThis.__bgPgPool ??= new Pool({ max: 3 })` singleton |
| Neon Postgres | Running migrations from route handlers | Separate `migrate` script using the NON-pooled URL; run via `vercel env pull` + local CLI |
| Neon Postgres | ORM N+1 on dashboard reads | Prefer raw SQL with explicit JOINs for the dashboard queue query; benchmark <100ms for 500 students |
| NextAuth v5 beta | Treating beta updates as safe | Pin exact version; E2E sign-in test; Dependabot ignore |
| NextAuth v5 beta | Dev fallback `"local-dev-secret"` reaching prod | Throw on missing env vars in `NODE_ENV=production` (`CONCERNS.md` Auth HIGH) |
| Vercel Fluid Compute | Assuming per-instance globals work like "always warm" | Treat module-global state as a cache, not storage (fix `snapshot-store.ts`, `health-state.ts` — `CONCERNS.md` Fragile Areas MEDIUM) |
| Vercel Fluid Compute | `TZ` default (UTC) | Set `TZ=Australia/Sydney` in Vercel env vars |
| Vercel (deployment) | Relying on `vercel deploy --prod` from local | Push to `main`, let Vercel Git integration handle it; preserves deploy history for rollback (Pitfall 5 recovery) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loop-per-student fetch to Wisenet | Dashboard load time grows linearly with student count | Use bulk endpoints; p-limit concurrency; cache in Postgres | >50 students, morning bulk login |
| No Postgres index on `student_key` | `/api/actions/history` gets slow after a few months | Add `CREATE INDEX CONCURRENTLY ON actions_log(student_key, created_at DESC)` in migration 001 | 6-12 months post-cutover |
| Bulk action serial loop | 50-student bulk action takes 15-30s, hits Vercel timeout warnings | Single SQL `INSERT ... ON CONFLICT` for Postgres side; parallel Wisenet reads with concurrency cap (read-only so no contention) | 20+ students per bulk action |
| `unstable_cache` invalidation no-op | Stale dashboard after action; operator retries and multiplies load | Verify `revalidateTag` 2-arg signature in Next 16.2.1; add regression test (`CONCERNS.md` Cache Correctness MEDIUM) | First write on a freshly-cached path |
| Unbounded `actions_log` table | Postgres storage fills; slow queries | Partition by month OR add retention policy (e.g. archive >1yr to S3/Blob) | 12-24 months with real traffic |
| No HTTP cache headers on `/api/dashboard` | Every tab refresh = full Wisenet round-trip | `Cache-Control: private, max-age=30` + client-side React Query stale-while-revalidate | High tab-switching operator behavior |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Wisenet API key in client bundle | Arbitrary student data read by anyone with dev-tools | `WISENET_*` env vars server-only; never import from `src/lib/wisenet/*` into any `"use client"` component; add a client-bundle grep in CI |
| Wisenet API key in `NEXT_PUBLIC_*` | Public exposure | NEVER prefix with `NEXT_PUBLIC_` — these are bundled to browser |
| Rotated creds re-committed to `.env.example` by copy-paste | Next git pull exposes old key | `.env.example` has placeholder strings only, enforced via secret scanner |
| Session forgery via dev fallback | `"local-dev-secret"` reaching prod signs any session token | Fix `web/src/auth.ts:7,10,11` (`CONCERNS.md` Auth HIGH); throw on missing env in prod |
| CSRF-less mutations | A logged-in operator visits a malicious site, a cross-origin POST runs a bulk action | Add `Origin` check or CSRF token on all state-changing routes (`CONCERNS.md` Security LOW) |
| Service account JSON in Vercel build log | Full read access to all sheets leaks via log access | Pass via `SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY` env (single string, escaped `\n`) — never the raw JSON file |
| Staff allowlist drift | Ex-employees retain access | Allowlist in env var (mutable via Vercel UI); periodic review cadence in `docs/WORKFLOW.md` |
| Postgres role with superuser on runtime URL | A SQL injection = full DB compromise | Runtime URL uses a least-privilege role (INSERT/SELECT/UPDATE on specific tables only); migrations use a separate owner role |
| No 2FA enforcement | Stolen operator Google account = dashboard access | Document Google Workspace 2FA as mandatory (`CONCERNS.md` Security LOW) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No "archive link" on Day 1 | "Where did Jade's history go?" → duplicate outreach | Student Detail shows pre-cutover archive link prominently |
| No cutover banner | Operators think something broke | 30-day dismissible banner "New system live since [date]; archive at [link]" |
| Identical-looking UI on both systems during transition | Operator bookmarks the WRONG one | Visibly brand the new dashboard differently (banner color, header) during the 30-day overlap |
| Silent "not yet implemented" Wisenet gaps | Operator sees empty field, assumes student data is missing | Explicit "Not available from Wisenet" placeholder, not empty cell |
| Slow morning cold start (first operator gets 8s load) | Trust erosion | Warm-up cron hitting `/api/dashboard` every 5 min during business hours — or explicit loading skeleton that sets expectations |
| Operator clicks a bulk action while Wisenet rate-limits | 50% of bulk action silently fails | Progress toast + retry-on-failure with operator-visible counts |

## "Looks Done But Isn't" Checklist

- [ ] **Wisenet client:** Has field-map matrix documented? Covered 100% of `REQUIRED_COLUMNS` rows with GREEN/YELLOW/RED verdict? RED rows have explicit decisions?
- [ ] **Wisenet client:** Rate-limit + pagination verified empirically on production-scale data, not inferred from docs?
- [ ] **Wisenet client:** Zod schema covers every response field with `z.coerce.*`?
- [ ] **Postgres:** Pooled connection string in route handlers; unpooled reserved for migrations?
- [ ] **Postgres:** Singleton pool with `max: 3`; not `new Pool()` per request?
- [ ] **Postgres:** Index on `student_key` + whatever the `/api/actions/history` query filters on?
- [ ] **Timezone:** `TZ=Australia/Sydney` in Vercel env?
- [ ] **Timezone:** All dates through `Temporal` or `date-fns-tz`, no raw `new Date(string)`?
- [ ] **Validation port:** All 41 `Validation.gs` tests present (name-level) in Vitest?
- [ ] **Validation port:** Fixtures from `createSnapshot` / `createActionTestStudentFixture` / `createDashboardPayloadFixture` ported or equivalented?
- [ ] **Auth:** E2E sign-in test exists and runs post-deploy?
- [ ] **Auth:** Dev fallbacks (`"local-dev-secret"` etc.) throw in `NODE_ENV=production`?
- [ ] **Secrets:** Wisenet credentials pasted in chat are rotated?
- [ ] **Secrets:** Root `.gitignore` covers `.env*`, `*-credentials.json`, `service-account*.json`, `client_secret_*.json`, `begifted-ops-*.json`?
- [ ] **Secrets:** Secret scanner (`gitleaks`/`trufflehog`) runs on every PR?
- [ ] **Observability:** `X-BG-Deploy-Id` header on all `/api/*` responses for incident triage?
- [ ] **Observability:** Error tracking (Sentry/Vercel Agent) wired; first incident won't be debugged via `vercel logs` grep?
- [ ] **Retirement:** `docs/ARCHIVE_2026-04.md` lists spreadsheet IDs, owners, schemas, retention?
- [ ] **Retirement:** Legacy URL serves a "moved" page, not a 404 or stale data, for 30 days?
- [ ] **UI:** Student Detail surfaces archive link for pre-cutover history?
- [ ] **UI:** Day-1 banner + operator training?
- [ ] **Cache:** `revalidateTag` regression test (write → read → assert fresh) passes?
- [ ] **Cache:** `snapshot-store.ts` / `health-state.ts` either moved to Postgres OR documented as per-instance-only in `/api/health` response?

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wisenet field gap found post-cutover | HIGH | 1. Hotfix patch: UI placeholder for missing field. 2. Emergency operator comms. 3. Phase 1.5 field-remap PR. 4. Consider Wisenet support ticket for custom field. |
| Silent type coercion discovered | HIGH | 1. Grep for `<` / `>` / `===` against fields from Wisenet. 2. Add Zod `z.coerce` at the client boundary. 3. Re-run ported `Validation.gs` tests. 4. Consider whether priority-scoring output needs to be recomputed retroactively for logged data. |
| Timezone bug — calendar day drift | MEDIUM | 1. `TZ=Australia/Sydney` hotfix. 2. Audit all `new Date(` usages. 3. Re-assert `testCalendarGroupsStudentSessionsByDay`-equivalent Vitest test. |
| Neon connection-pool exhaustion | HIGH | 1. Switch to pooled URL if not already. 2. Drop `max` to 3. 3. Consider `@neondatabase/serverless` HTTP driver for read routes. 4. Verify no `new Pool()` per-request patterns. |
| `HTTP -1` / partial response | HIGH | 1. Check `X-BG-Deploy-Id` matches latest. 2. Check response size; split if >1MB. 3. Force `Content-Length` header. 4. Verify `unstable_cache` isn't corrupted by deploy-rotation. |
| NextAuth beta regression | HIGH | 1. Pin to previous beta. 2. Vercel rollback to last green deployment. 3. Reproduce in preview branch before retrying the bump. |
| Apps Script retired too early | MEDIUM | 1. Un-stop Apps Script deployment (fast — clasp redeploy). 2. Restore access level. 3. Identify the missed workflow. 4. Re-plan retirement. |
| Compliance gap — missing archive | HIGH | Hard to recover — that's the point. Archive BEFORE retirement, not after. |
| Secret leak in commit | HIGH | 1. Rotate the leaked secret IMMEDIATELY. 2. Force-push to remove commit (IF not shared to forks). 3. Assume leaked anyway — history is permanent. 4. Audit Vercel logs + GitHub for exposure window. |
| Operator confusion over missing history | LOW | 1. Add banner. 2. Add archive link in Student Detail. 3. Send team-wide comms. Low cost IF caught in week 1. |

## Pitfall-to-Phase Mapping

Suggested phase structure — roadmap author may re-sequence but these are the natural boundaries.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Wisenet field gap | **Phase 1** — Discovery | `.planning/research/WISENET_FIELD_MAP.md` exists, every `REQUIRED_COLUMNS` row classified |
| 2. Silent type coercion | **Phase 2** — Wisenet client | Zod schema per endpoint; ported `testAlertThresholdBoundaryAtExactlyTwoCredits` + siblings pass |
| 3. Timezone mismatch | **Phase 2** — Wisenet parsing + **Phase 3** — UI | `TZ=Australia/Sydney` set; Temporal-based date tests pass |
| 4. Postgres pool exhaustion | **Phase 2** — Postgres setup | Load test: 50 concurrent `/api/actions` no "too many clients"; singleton pattern in `web/src/lib/db/client.ts` |
| 5. HTTP -1 regression | **Phase 3** — UI wire-up + **Phase 4** — deploy | `X-BG-Deploy-Id` header present; `Content-Length` on `/api/dashboard`; cache invalidation regression test green |
| 6. NextAuth beta breakage | **Phase 4** — deploy hardening | Pinned version; E2E sign-in test green on Vercel preview |
| 7. Apps Script switched off early | **Phase 5** — retirement | Checklist: ports-done, snapshot-done, moved-page-live, 30d-wait-started |
| 8. Secret leak | **Phase 0** — pre-work | Wisenet creds rotated; root `.gitignore` hardened; `gitleaks` CI workflow present |
| 9. Cold-start confusion | **Phase 3** — UI | Archive-link affordance in Student Detail; day-1 banner; operator comms scheduled |
| 10. Wisenet rate-limit surprise | **Phase 1** — discovery + **Phase 2** — client | Rate-limit fingerprint recorded; client has `p-limit` + `Retry-After` handling |
| 11. Compliance gap (audit trail) | **Phase 0** — confirm requirements + **Phase 5** — archive | `docs/ARCHIVE_2026-04.md` present; CSV snapshots taken; retention policy decided |
| 12. `codex/dashboard-load-performance` branch drift | **Phase 0** — pre-work | `.planning/NOTES_CODEX_BRANCH.md` enumerates the diff; keep/drop decisions logged |

### Recommended phase structure inferred from this map

Phase 0 — Pre-work (secrets, branch hygiene, compliance confirmation)
Phase 1 — Wisenet discovery (field map + rate-limit fingerprint)
Phase 2 — Data layer (Wisenet client + Postgres schema + ported Validation.gs assertions)
Phase 3 — UI wire-up (rewire dashboard against new data layer; archive-link affordance)
Phase 4 — Deploy hardening (auth E2E, observability, `X-BG-Deploy-Id`, timezone)
Phase 5 — Apps Script retirement (ports done as precondition; moved-page; archive manifest; 30-day wait)

**Phase 0 is not cosmetic.** Secret rotation + branch hygiene + compliance-policy decisions are blockers for Phase 1. Roadmap author should resist the urge to skip Phase 0.

## Sources

- Repo files (HIGH confidence):
  - `.planning/PROJECT.md` — milestone constraints, out-of-scope list, field-coverage unverified flag
  - `.planning/codebase/CONCERNS.md` — migration-parity risks, monoliths, pre-release deps, HTTP -1 pattern, cache correctness, fragile areas, test coverage gaps, secrets hygiene, scaling limits
  - `.planning/codebase/INTEGRATIONS.md` — current integration shape (googleapis, NextAuth, ScriptProperties, action sheets); missing pieces (no Sentry, no cron)
  - `.planning/codebase/TESTING.md` — 41 `Validation.gs` tests enumerated; Vitest harness; `compare-live` parity script; fakes & fixtures patterns
  - `CLAUDE.md` — HTTP -1 rule, Apps Script ownership slices, validation suite cadence
- Platform (MEDIUM confidence, verified against orchestrator's 2026-02-27 Vercel knowledge update):
  - Vercel Fluid Compute reuses instances across concurrent requests; Node 24 LTS default; 300s default timeout; `@vercel/config` / `vercel.ts` supported
  - Neon offers pooled (`-pooler.<region>.aws.neon.tech`) and unpooled connection strings; `@neondatabase/serverless` HTTP driver for serverless reads
  - NextAuth v5 still beta as of 2026-04; beta-to-beta breaking changes already experienced (per `docs/nextjs-shadow-handoff.md:26` referenced in `CONCERNS.md`)
- Wisenet (LOW confidence — explicitly unverified per `PROJECT.md:66`):
  - Treated as "unknown Australian student-management REST API" — Phase 1 is investigation, not assumption
  - All Wisenet-specific pitfalls (rate-limit, pagination, field shape, type coercion, AEST default) are hypothesis-driven; verification is a Phase 1 deliverable

---
*Pitfalls research for: BeGifted Ops Wisenet migration*
*Researched: 2026-04-20*
