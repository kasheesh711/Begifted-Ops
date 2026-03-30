# App Overview

This document is the engineering-facing summary of what the BeGifted Package Expiry Dashboard is supposed to do. The full product source of truth is the PRD document `Begifted Package Expiry Dashboard_PRD.docx`. Use this Markdown file for repo-local onboarding and for planning code changes.

## Purpose And Users

The dashboard is an internal admin operations tool for BeGifted Education. It helps admin staff identify which students are at risk of running out of tutoring credits, decide who needs follow-up first, and prepare parent outreach before credits are exhausted.

Primary users:

- admin staff monitoring package balances
- operations or strategy staff reviewing credit risk and follow-up priority

## Problem And Operational Objective

BeGifted sells tutoring through prepaid credit packages. Before this dashboard, staff had to inspect multiple spreadsheets manually to understand a student's real balance and future risk.

The operational objective is to:

- show which students are at risk right now
- project when packages will fall below the alert threshold
- support proactive parent outreach
- reduce cases where students continue into negative credits without prior notification

## Data Sources

The app reads live data from two Google Sheets files through Apps Script.

Required sources:

- `BeGifted Student Credits` / `Aggregations`
  - key fields: `Student Name`, `Parent Name`, `Class Subject`, `Current Remaining Credits`, `Current Total Credits`
  - role: starting balance and package metadata
- `BeGifted Education Analytics` / `Credit_Control`
  - key fields: `Student Name`, `Package/Program`, `final_status`, `teacher_feedback`, `credits_consumed`, `session_duration`, `session_date`
  - role: detect sessions that should affect actual balance
- `BeGifted Education Analytics` / `Upcoming Sessions`
  - key fields: `Student Name`, `Package/Program`, `Scheduled Date`, `Session Duration`, `Session Status`
  - role: project future balance consumption
- `BeGifted Education Analytics` / `Students`
  - key fields: `student_name`, `Remaining Credits`
  - role: filter active versus inactive students
- `BeGifted Education Analytics` / `Students & Courses`
  - key fields: `Student Name`, `Class Name`, `Class Subject`
  - role: identify excluded package types

## Current Business Rules

The current implementation shape in `Code.gs` and the PRD indicate this flow:

1. Load all required sheets.
2. Keep only active students.
3. Exclude package types that should not count toward package alerts.
4. Calculate an actual remaining balance by adjusting the reported balance with pending deductions.
5. Project upcoming sessions in chronological order.
6. Assign a status used for prioritization and UI display.

### Active Student Filter

Students are considered active when `Remaining Credits` in the `Students` sheet is neither `N/A` nor empty. Numeric values, including `0` or negative values, still count as active.

### Balance Model

The dashboard distinguishes between:

- `Current Remaining Credits`: the value from `Aggregations`
- `Actual Remaining Credits`: the balance used for alerts and projection after pending deductions are applied

The PRD defines:

`Actual Remaining = Current Remaining - Pending Deductions`

### Pending Deductions And Session Consumption

Credits are modeled as one credit per 60 minutes of session duration.

Examples:

- 60 minutes = 1.0 credit
- 90 minutes = 1.5 credits
- 120 minutes = 2.0 credits

The app uses historical session data from `Credit_Control` to identify sessions that affect the effective balance before future projection. Upcoming sessions are then applied in chronological order to project when the balance crosses alert or exhaustion thresholds.

### Package Deduplication

If a student appears more than once for the same package in `Aggregations`, the package record with the highest total credits is retained. This is intended to reduce duplicate package cards caused by source-sheet data quality issues.

### Package Exclusion Rules

Packages are excluded from the dashboard when the package context indicates either:

- `Pretest`
- `Trial`

The current code treats either keyword in `Students & Courses`.`Class Name` or `Class Subject` as an exclusion match for that student's package.

## Status Definitions

The dashboard uses four package-level statuses:

- `notify`: actual remaining credits are already below the immediate alert threshold
- `watch`: projected to fall below the alert threshold within the notification window
- `ok`: not currently at immediate risk and no near-term alert is projected
- `nodata`: no useful projection is available, typically because there are no upcoming sessions

The current code uses:

- alert threshold: `2` credits
- watch window: `30` days

## What The Dashboard Should Show

The current frontend now organizes the operator experience into three layers:

- `Command Center`
  - action KPIs for immediate outreach load, near-term risk, missing schedule coverage, and pending deduction backlog
  - a prioritized package queue ranked by urgency, depletion timing, and data confidence
  - a contextual inspector explaining why the selected package is risky and what should happen next
- `Analytics`
  - trend views comparing `notify`, `watch`, `ok`, and `nodata` over stored refreshes
  - segment views for package concentration, cadence, parent concentration, and risk drivers
  - planning views for projected outreach and exhaustion load over upcoming weeks
- `Student Detail`
  - one student header with roll-up status and package counts
  - per-package modules for current balance, balance waterfall, projection, and recommended action
  - communication support via generated LINE message drafts

The original core requirements remain intact:

- overview metrics summarizing total students and package risk buckets
- prioritized action tables for urgent and watch-list packages
- a student sidebar sorted by status, with filters and search
- student detail views with one package card per active package
- package projections showing balance reduction across upcoming sessions
- a generated LINE message template for parent communication

## High-Level Data Flow

The current technical flow is:

1. Admin opens the Apps Script web app.
2. `doGet()` returns the dashboard shell immediately instead of embedding the full payload into the HTML template.
3. `dashboard.html` requests the dashboard payload asynchronously from Apps Script after the shell is already visible.
4. `Code.gs` either serves a cached dashboard payload or reads the required sheets and applies business logic on a fresh recompute.
5. The backend enriches the payload with queue ranking, summary analytics, data-quality flags, and segment data.
6. On a fresh recompute, the app stores a lightweight comparison snapshot in Apps Script script properties for delta and trend views.
7. The payload is cached in chunked `CacheService` entries for 2 minutes so warm loads can reuse the same data generation result.
8. The frontend reconstructs the payload, then renders the command center, analytics views, detail views, and message templates client-side.

### Load-Path Notes

- The async bootstrap avoids the prior blank-screen behavior where HTML delivery was blocked on spreadsheet reads.
- The cached payload keeps `lastUpdatedAt` stable across cache hits because it reflects payload generation time, not page-open time.
- Snapshot persistence happens only on fresh recomputes so delta and trend baselines do not churn on repeated page loads.

## Expected Staff Actions

The app is not just a reporting view. It is meant to support operations decisions:

- identify packages requiring immediate parent contact
- monitor packages that are not urgent yet but will soon need follow-up
- inspect a student's package-level projections before contacting the parent
- copy a prewritten LINE message appropriate to the package state

## Remaining PRD Follow-Ups

The following gaps remain after the current business-rule cleanup:

- repository reference:
  - the PRD still names the older GitHub repository path
  - the active collaboration repo is now `kasheesh711/Begifted-Ops`
- deployment/access wording:
  - the tracked manifest currently uses `ANYONE_ANONYMOUS`
  - the intended production access model should be confirmed before the next hardening pass

## Canonical Pending Deduction Rule

Pending deductions currently mean:

- historical session in `Credit_Control`
- `final_status` is `ENDED`
- `teacher_feedback` is blank or `0`
- `credits_consumed` is `0`

These sessions are treated as completed operationally but not yet reflected in consumed credits, so they reduce the dashboard's `Actual Remaining Credits`.

## Validation Harness

The repo now includes `runValidationSuite()` in `Validation.gs` for deterministic fixture-based checks of:

- `Trial` exclusion
- `Pretest` exclusion
- pending deductions
- watch/notify boundaries
- no-data status behavior
- duplicate package deduplication
- low-balance packages without schedule data
- priority-score ordering
- summary delta calculations against stored snapshots
- weekly alert bucket aggregation
- dashboard payload cache miss and cache hit behavior
- chunked cache storage for large payloads
- chunked browser transport manifest and chunk reconstruction helpers

## How To Use This Doc

- Read this file first when starting engineering work on the dashboard.
- Use the PRD for full product detail and business context.
- If a planned code change alters any rule described here, update this file in the same PR.
