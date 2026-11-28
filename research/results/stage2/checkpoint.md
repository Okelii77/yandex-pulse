# Stage 2 checkpoint — 2026-11-28

## Sources and measured evidence
- Stage 1 baseline production commit 444e60b637cf5f3f14dafe85cadd6572d6f53b8f. No changes to main or production.
- First CI run 46136630005: Rust builds succeeded; shared state and cooldown fixtures passed. Go HTTP parity 18/19, Rust 17/19. Benchmark correctly skipped.
- Follow-up CI 46138272071, commit d321615850058ca385f4000c4cc840c2befc6c6c: compilation and protocol/parity step passed; randomized 100-repeat benchmark was still running at checkpoint. Do not infer final performance from this.
- Frontend CI 46138331198, job 140958518371: success. Raw browser measurements are in frontend-results.json. 10 observations per viewport, 50 graph interactions per viewport. Both viewport runs share one browser; JS heap is not total RAM or evidence of a leak. Cache disabled; no external requests. Real network speed and device CPU not measured.

## Scheduler
100 registered main schedule runs, all successful, 31 Oct–28 Nov, median gap 6.9089h; maximum 11.9206h; shortest 2.9039h. Current cron 13,43 * * * *. created_at and run_started_at were identical in those records, which cannot reveal time before a run is created. GitHub documents dropped/delayed schedule events, not the specific cause of this repository's missing events.
Use independent Cloudflare Cron for eligible public fetch probes (Free CPU limit 10ms per trigger; verify actual CPU, subrequests and concurrent connections before deploying). Native Go/Rust binaries cannot simply run in a Worker; containers require Workers Paid. Standard hosted GitHub runners in public repo are free; use a trusted external scheduler dispatch with atomic slots and a freshness watchdog, retaining fallback schedule. External dispatch still depends on Actions runner availability. Rust/Wasm is a separate edge port, not native binary execution. No new live schedules, production data or credentials changed.
https://developers.cloudflare.com/workers/platform/limits/
https://developers.cloudflare.com/containers/platform/pricing/
https://docs.github.com/en/actions/concepts/billing-and-usage
https://docs.github.com/en/actions/how-tos/troubleshoot-workflows

## D1 safety
Only local SQLite materialization validated. D1 Free has 5M rows read/day and 100K rows written/day, with hard limits; Workers Paid is metered. Billing subscription API needs Billing Read and was previously unavailable through connector. Do not create or deploy a test database until actual plan and quota isolation can be confirmed. Never run writes against the production database for these experiments.
https://developers.cloudflare.com/d1/platform/pricing/
https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/

## Remaining gates
Full native authorization parity, full schema equivalence, robust DNS and retry tests, complete Rust redirector/Gate integration, paired conditional-request frontend profiling, D1 remote isolated test, live end-to-end freshness and publication measurements. No final language selection.
