# Ynison safety rollout

This change keeps production automatic Ynison probing disabled even when the old environment flag is accidentally set to 1. Both manual clients require an authenticated D1 reservation first. Deploy migration 0002 and the matching Worker before enabling the new manual workflow on main. No diagnostic should run on an untrusted branch. The one-shot JS transport is a reference implementation of the SDK wire format, **not** a claim of validation of @dvxch's internal parser. Python uses the pinned MarshalX 3.2.2 client with raw-frame and redirect validation. Neither client sends playback commands; initial protocol registration may create a transient controller session.

A reservation survives a killed runner for 24 h. Successful finalization sets a minimum 15-minute gap, ordinary errors 1 h, unknown errors 24 h, and server go-away is never shortened (15-second grace). This intentionally prevents immediate back-to-back comparison. Manual selection is per run. The gate is not exposed publicly; it uses a dedicated GitHub OIDC audience and the main diagnostic workflow identity. Gate errors stop the run rather than falling back to the archive.

Deployment order: review CI, migrate D1, deploy Worker, merge the reviewed workflows, verify unauthenticated requests return 401, then run one diagnostic only if no external client has outstanding cooldown. Run the second client only after the reported gate time. Do not turn on periodic diagnostics until repeatability and account-side safety have been verified. Live deployment and testing are not part of this draft.

## Performance baseline

Production run [45617483290](https://github.com/Okelii77/yandex-pulse/actions/runs/45617483290), 25 Nov 2026: elapsed time from GitHub step start to its success log was approximately 411 ms for loading the previous snapshot and 663 ms for OIDC ingestion (includes runner overhead). The new timing logs measure transfer directly. The mock frontend test verifies 28 status requests and 1 history request instead of 28 + 28; the Worker cache additionally avoids repeated history scans within a revision. Actual production latency after deployment must be measured separately.
