"""Send only sanitized status.json to the Cloudflare Worker; never log tokens."""
from __future__ import annotations
import json
import os
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]

def main():
    base = os.environ["PULSE_API_URL"].rstrip("/")
    token = os.environ.get("PULSE_INGEST_TOKEN", "").strip()
    if not token:
        url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", "")
        runtime_token = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
        if not url or not runtime_token:
            raise SystemExit("GitHub Actions OIDC environment is unavailable")
        separator = "&" if "?" in url else "?"
        request = urllib.request.Request(
            url + separator + "audience=yandex-pulse-ingest",
            headers={"Authorization": "bearer " + runtime_token})
        with urllib.request.urlopen(request, timeout=15) as response:
            token = json.loads(response.read(30000))["value"]
    if not base.startswith("https://") or not token:
        raise SystemExit("Live API / ingestion credential missing")
    raw = (ROOT / "site" / "status.json").read_bytes()
    if len(raw) > 100_000:
        raise SystemExit("Status JSON too large for API")
    json.loads(raw)
    request = urllib.request.Request(
        base + "/api/ingest", data=raw, method="POST",
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "application/json",
                 "User-Agent": "YandexPulseProbe/1.1"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status != 200:
                raise RuntimeError("ingest rejected")
            output = json.loads(response.read(8192))
            if output.get("ok") is not True:
                raise RuntimeError("ingest failed")
        print("Live snapshot accepted by Cloudflare D1; GitHub Pages redeploy not required")
    except Exception as exc:
        # Avoid urllib HTTPError string which can reveal URLs and error bodies.
        print("Live upload failed:", type(exc).__name__)
        raise SystemExit(1)

if __name__ == "__main__":
    main()
