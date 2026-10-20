# Yandex Pulse API · Cloudflare Workers + D1

**Развёрнуто:** Worker `yandex-pulse-api` и D1 `yandex-pulse` уже созданы в Cloudflare.

- Worker API: https://yandex-pulse-api.oleg-pulse-03.workers.dev
- Доступность: GET `/api/health`; статусы: GET `/api/status`; история: GET `/api/history`.
- Автоматическая передача из GitHub Actions через подписанный **OIDC** JWT (без постоянного секрета).
- История из первоначальных JSON перенесена в D1. Проверки не создают новые коммиты и не деплоят Pages.
- **Ручной запуск ещё не включён**, пока владелец не сохранит в Worker Secrets два ключа: `TURNSTILE_SECRET` и `GITHUB_ACTIONS_TOKEN`.

## Завершить кнопку «Проверить сейчас»

### 1. Cloudflare Turnstile Secret

В Dashboard → Turnstile → **Yandex Pulse manual diagnostics** (виджет уже создан для `okelii77.github.io`) скопируйте **Secret key**. Добавьте в Worker `yandex-pulse-api` → Settings → Variables and Secrets новую секретную переменную:

```text
TURNSTILE_SECRET
```

Значение — Secret key Turnstile. **Не путать с sitekey**, который уже опубликован в JS; sitekey специально является публичным.

### 2. Ограниченный GitHub API токен

Создайте **Fine-grained personal access token**: https://github.com/settings/personal-access-tokens/new

Выберите **Only select repositories → Okelii77/yandex-pulse**. Назначьте разрешение **Actions: Read and write** (остальные минимум: только обязательные метаданные), а срок действия — например 30–90 дней. Запишите дату окончания для дальнейшего продления.

Скопируйте токен только в секрет Worker `yandex-pulse-api`:

```text
GITHUB_ACTIONS_TOKEN
```

В ChatGPT или публичный репозиторий токен не отправляйте.

После сохранения двух секретов Worker автоматически начнёт отвечать `trigger_ready:true` в `GET /api/health`. Сайт проверяет это свойство и активирует кнопку запуска прямо в интерфейсе. При нажатии Turnstile проверяет пользователя, глобальное ограничение не разрешает новые запуски чаще одного раза в 10 минут.

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
