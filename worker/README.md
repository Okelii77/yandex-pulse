# Yandex Pulse API · Cloudflare Workers + D1

**Status:** source code is prepared but the Worker is **not deployed** until the repository owner creates a Cloudflare account, D1 database, and binds secrets. The existing GitHub Pages/Actions monitoring remains active until cutover.

## What the architecture does

- GitHub Pages serves only HTML, CSS, icons, and client-side JavaScript.
- GitHub Actions runs Python service probes every 30 minutes or when dispatched.
- Worker `POST /api/ingest` receives only status metadata and writes it to Cloudflare D1.
- Worker `GET /api/status` and `GET /api/history` return public status/history.
- Worker `POST /api/trigger` validates a Cloudflare Turnstile challenge **server-side**, atomically limits triggers across all users (once per 10 min), and dispatches the fixed `pulse.yml` workflow via GitHub API.
- **No OAuth secret, Yandex token, or personal data is sent to the browser or D1.**
- After migration is switched on, **scheduled / manual probes do not commit JSON to git and do not republish Pages**. Code changes still deploy Pages.

## Free tier boundaries

Workers Free currently allows 100k Worker requests/day (10 ms active CPU per invocation). D1 Free currently includes 5m rows read/day, 100k rows written/day, 5 GB total storage with a 500 MB per-database cap. Free quotas are finite, not a capacity guarantee for arbitrary public traffic.

D1 history returns a downsampled series for older periods to conserve reads. This is **measurement history**, not proof of global outages.

## Setup — once, on the owner's PC

Requires Node.js, Git and Cloudflare free account.

1. Sign up and log in at Cloudflare, install Wrangler and authorize it:

   ```powershell
   cd worker
   npm install
   npx wrangler login
   ```

2. Create the free D1 database:

   ```powershell
   npx wrangler d1 create yandex-pulse
   ```

3. Copy the **database UUID** from the response into `worker/wrangler.toml`, replacing `REPLACE_WITH_YOUR_D1_UUID`. Commit the UUID; it is an identifier, **not** a password.

4. Apply the migration:

   ```powershell
   npx wrangler d1 migrations apply yandex-pulse --remote
   ```

5. Create a **new high-entropy token** for ingestion, e.g. in PowerShell:

   ```powershell
   $key = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
   $key | Set-Clipboard
   ```

   Add this same token in **both** places without sharing it in chat:
   - Cloudflare Worker Secret: `INGEST_TOKEN`
   - GitHub repository Actions Secret: `PULSE_INGEST_TOKEN`

   Set the Cloudflare secret with `npx wrangler secret put INGEST_TOKEN`. Paste from clipboard. Do **not** hard-code it in `wrangler.toml` or GitHub files.

6. In GitHub, create a **fine-grained PAT** restricted to the **single** repo `Okelii77/yandex-pulse`, permission **Actions: Read and write** only. In Cloudflare, add the token **solely as a Worker Secret** `GITHUB_ACTIONS_TOKEN` (via `npx wrangler secret put GITHUB_ACTIONS_TOKEN`). Never paste it into site files or D1.

7. Create a **Cloudflare Turnstile** widget with allowed hostname `okelii77.github.io`. Its **sitekey** is public, but its **secret key** goes to Cloudflare Worker Secret `TURNSTILE_SECRET` with `npx wrangler secret put TURNSTILE_SECRET`.

8. Deploy the Worker:

   ```powershell
   npx wrangler deploy
   ```

   The output provides a public URL like `https://yandex-pulse-api.<account>.workers.dev`. This is **not a secret**.

9. Verify `GET https://<your-worker-host>/api/health` responds `{"ok":true,...}`.

10. **Cutover GitHub Actions (pending)**: the existing workflow must be updated to load cooldown state from Worker, upload status to `POST /api/ingest`, and skip JSON git commits and Pages publication during scheduled checks. Set:
    - GitHub Repository Variable `PULSE_API_URL` to the public Worker URL
    - GitHub Repository Variable `PULSE_TURNSTILE_SITE_KEY` to the public Turnstile sitekey

    The script `monitor/build_site_config.py` generates *public frontend config* from these two values at deploy time, while `monitor/upload_live.py` transmits the metadata on scheduled checks. **Do not activate live mode until the Worker is accessible and the GitHub workflow integration is reviewed and deployed.**

11. Once connected, use **Actions → Yandex Pulse · Check & Publish → Run workflow** to seed D1 with its first snapshot and verify the site shows a **live** source. Keep static JSON as temporary fallback until the new pipeline has accumulated history.

## API endpoints

| Route | Access | Returns |
| --- | --- | --- |
| `GET /api/health` | Public | API health only; not Yandex state |
| `GET /api/status` | Public | Latest sanitized snapshot |
| `GET /api/history` | Public | Recent history, older points downsampled |
| `POST /api/ingest` | Secret Bearer token | Accepts snapshot from Actions |
| `POST /api/trigger` | Turnstile token + same-site Origin | Dispatches the fixed GitHub workflow |
| `OPTIONS` | Allowed site origin only | CORS preflight |

A Worker cannot perfectly identify humans by `Origin` alone; the **Turnstile Siteverify server-side check** and **atomic global cooldown** enforce abuse protection. Manual checks cannot be triggered by an unauthenticated simple GET request.

## Local checks

```powershell
cd worker
npm test
npm run dev
```

The source includes tests for unconfigured D1, CORS, and authentication. Avoid running paid Yandex AI probes merely to test the Cloudflare integration.

## No secret leakage

Worker Secrets are never imported to the browser. The public dashboard uses only `site/api-config.js`, which holds the Worker URL and Turnstile **sitekey** (both public); it never stores a PAT, Worker ingestion token, or account OAuth credentials.
