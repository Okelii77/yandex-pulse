# Yandex Pulse architecture lab — 2026-11-28

Base: 444e60b637cf5f3f14dafe85cadd6572d6f53b8f. Isolated research, no production changes. No Yandex requests, no secrets, no deployments. This is a synthetic workload model, not a complete replacement of monitor/check.py.

## Reproduction
Run from this directory on Linux, with Go 1.23.2 and Python 3.13.5 (or record the versions used):
```sh
go build -o mock mock.go
go build -o bench-go bench.go
python -S run.py
python -S history_bench.py
```
The fixture binds localhost:18761; ensure this port is free. No third-party packages. The two clients deliberately do not reuse connections. There are 22 simulated public HTTP operations, three account probes, 8-way concurrency and fixed delays of 0/30/80 ms. The baseline repeats account initialization twice; the optimized clients reuse initialization logically, not a real OAuth client. The simulated TLS checks use HTTP; absent or optional paid API checks, errors, actual TLS, OAuth, throttling and real protocol compatibility are not modeled. Go and Python queue scheduling differs slightly. Process CPU and max RSS include startup. Six measured repetitions per case, randomized order after warm-up. p95 is descriptive only; p99 is not meaningful. Production timing requires a dedicated parity suite.

## Observed local results
| Delay (ms) | Python baseline p50/p95 (ms) | Python optimized p50/p95 (ms) | Go optimized p50/p95 (ms) |
|---|---|---|---|
| 0 | 23.09/26.46 | 27.36/30.91 | 2.08/2.59 |
| 30 | 267.70/271.96 | 144.42/145.09 | 123.66/123.89 |
| 80 | 669.01/671.06 | 349.29/352.73 | 324.78/327.76 |

80ms scenario: process CPU median 113.60/120.73/9.77 ms; peak RSS median 23744/24320/9472 KiB; requests 27/25/25. The algorithm wins most network time, Go reduces process overhead. Do not extrapolate directly to production.

SQLite: 48960 deterministic synthetic samples, 7276 output points, 258916 bytes, same snapshot as query, 15 reps. Query+serialization p50/p95 107.113/116.218 ms; reading precomputed identical snapshot 0.030/0.106 ms. This excludes computing and refreshing the cache and is not D1 network/CPU time. Snapshot revision and rolling retention boundaries must be designed before deployment.

## Production observations (read-only)
- 2026-11-28 Actions run 46122596736: workflow 29s, check.py ~15.33s, ingestion POST 404ms/15606 bytes. GitHub OIDC issuance is separate. https://github.com/Okelii77/yandex-pulse/actions/runs/46122596736
- Current cron config: 13,43 * * * *. Observed recent run gaps ~8–10h; GitHub documents possible delayed/dropped scheduled workflows. Not proof of why these particular runs were missed.
- D1 read-only metadata: 684032 bytes, 4 tables, 5245 samples, 27 check IDs, 2026-10-20 through 2026-11-28. Older-than-30d rows require verification, no cleanup performed.
- JS Wire live success 2026-11-25: https://github.com/Okelii77/yandex-pulse/actions/runs/45622646665/job/139234560283 . Python Windows remains unverified. Keep centralized gate and honor retry-after; no direct live probes were started.

## Recommendation
First fix freshness/scheduler observability and reduce redundant work. Test the Go engine with actual endpoint behavior and differential fixtures; preserve Python auth SDK until parity. Keep JS Wire as verified reference; compare Rust (Tokio + tungstenite) only after toolchain and shared fixtures are available. Keep Worker JS/TS, D1 and static frontend; evaluate precomputed history behind feature flag in a test DB. Do not merge or deploy any prototype without production safety approval.
