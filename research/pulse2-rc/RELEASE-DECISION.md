# Yandex Pulse 2.0 — RC decision, 2026-11-28

Status: offline integration candidate; **not approved for production or deployed staging**. Baseline main 444e60b637cf5f3f14dafe85cadd6572d6f53b8f remains unchanged.

## Evidence
- Reproducibility run 46139340513: two runners, 2740 measured cycles, zero execution errors. Full evidence and paired summary in research/results and pulse2-rc/BENCHMARKS.md.
- 46146243209: 30 Rust, 30 Go, 15 Rust system-root cycles. Rust wall p50/p95 133.98/135.35 ms; Go 99.05/102.61 ms. Initialization 37.04 vs 0.35 ms; probe 93.99 vs 94.75 ms. Full engine VmHWM 12.27 vs 8.88 MiB. Rust system-root run init 36.95 ms; toggling built-in roots does not explain the overhead. Rust is preferred for further native development, not declared overall winner. Go remains offline alternative, not a live production fallback.
- Five native Music fixture scenarios; REST account/status, history historyTabs, queues result.queues and device header. Retain Python SDK until real parity.
- 46146153537: 1489 publications, 31 virtual days, 44670 rows, 32 reservation contenders, 16 starts, 12 concurrent history requests, publish p50/p95 18.33/21.43 ms. Local workerd/D1, not remote quota or calendar uptime.
- 46146243209: both native outputs ingested by local D1, 34 browser cards, stale flags and conditional 304 status/history (0 response body bytes). Browser navigation and ingest timings measured separately, not production latency. 23 Python and 34 Node tests and browser regressions passed.
- Edge lab 46139949968: JS/TS/hybrid median 4.088/4.110/4.056 ms, same workerd process CPU 330 ms per 100 warm requests. Full Rust Worker request hung even on /ping without D1. Upgrade diagnostic 46146084881 additionally exposed incorrect manifest root (../index.js); root corrected in 522d333. New diagnostic 46146405893 pending at this checkpoint. Underlying old runtime hang not yet proven fixed. Do not use WASM in RC edge.
- Production run 46142432028: workflow 30 s, check.py ~12.21 s, upload reported 313 ms / 15606 bytes; aggregate 24 ok, 1 disabled, 1 no_data, 7 not_configured, 1 down. Ynison autoprobe 0. Last schedule 46122596736; later runs were manual. No comparable live RC timings or actual cloud quota measurements.

## Architecture
Rust public Core (HTTP/TLS, 22) + Python adapter (3 music + 8 credential checks) + existing JS Wire and authoritative Ynison gate (1). TypeScript control plane, D1 SQL, existing HTML/CSS/JS frontend with ETag, delta and adaptive polling. Preserve 90-day raw retention and 30-day display window. No duplicate SDK dependencies. See README.md library review and matrix.json, which separates fixtures from live checks.

RC worker excludes existing manual diagnostic/Turnstile routes: staging manual capability disabled; before production, integrate/proxy those routes safely without duplicating gate or weakening auth. Current draft is not a drop-in production replacement. Native Rust Ynison cannot acquire existing gate (only python/javascript); do not bypass. Potentially paid calls stay off. Real public Rust mode prepared but not exercised. Go fixture-only. Full native auth/Ynison parity, live DNS/redirect differences, lockfiles and pinned toolchain, remote D1 behavior, actual Cron dispatch, sustained observation and security review are release blockers.

## Permission gates and migration
1. Approve dedicated isolated Worker and D1, after checking Free account shared limits; no paid resources or production data access. No synthetic data import into production.
2. Approve a repo-scoped GitHub App with Actions:write and minimal metadata read, or fine-grained alternative. Install only on this repo. Store credential as Worker secret; use dedicated protected RC environment and separate OIDC audience/ref/workflow. Do not reuse production publish credentials. Review dispatch-workflow.DRAFT.yml; register on default branch only with explicit approval, disabled schedule and guarded inputs.
3. Approve limited read-only external tests on real APIs and credential adapters; coordinate cadence with existing monitor, no paid calls, no additional Ynison diagnostic without existing gate and explicit authorization. Validate every matrix row where safe.
4. Only after smoke, failure injection, manual-route parity and an agreed observation period, authorize Cron and later backup/versioned additive migration and main release. Measure actual freshness, publication, 304 payload, D1 rows read/written, scheduler/dispatch errors. Release acceptance: no duplicate active workflow per slot, no stale overwrite, no loss of 34 component semantics, no gate regression, no new charges; do not cut over on mock success alone.

## Rollback
Disable RC dispatch/Cron, let in-flight leases expire or complete, switch UI/API/monitor back to existing production versions. Keep old Worker and workflow available. Do not delete D1 production history or downgrade/reset authoritative Ynison cooldown. Export backup before any approved migration; restore versioned code, not stale gate state. No production rollback currently necessary.
