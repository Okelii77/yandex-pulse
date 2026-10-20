"""Load previous live state before probes to preserve Ynison/paid cooldowns."""
from __future__ import annotations
import json
import os
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]

def main():
    base = os.environ.get("PULSE_API_URL", "").rstrip("/")
    if not base.startswith("https://"):
        print("Live API not configured, using repository snapshot")
        return
    try:
        req = urllib.request.Request(base + "/api/status", headers={"User-Agent": "YandexPulseProbe/1.1"})
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status != 200:
                raise ValueError("non-200 response")
            data = response.read(100_001)
            if len(data) > 100_000:
                raise ValueError("snapshot too large")
        obj = json.loads(data)
        if not isinstance(obj, dict) or not isinstance(obj.get("results"), list):
            raise ValueError("invalid format")
        path = ROOT / "site" / "status.json"
        path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
        print("Loaded previous probe metadata (no account details)")
    except Exception as exc:
        print("No previous live state available:", type(exc).__name__)

if __name__ == "__main__":
    main()
