"""Generate public frontend Worker URL and Turnstile sitekey (NEVER secrets)."""
from __future__ import annotations
import json
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
base = os.environ.get("PULSE_API_URL", "").strip().rstrip("/")
key = os.environ.get("PULSE_TURNSTILE_SITE_KEY", "").strip()
if base and (not base.startswith("https://") or "'" in base or '"' in base):
    raise SystemExit("Invalid PULSE_API_URL")
if not key or not all(c.isalnum() or c in "_-" for c in key):
    key = ""
config = {"apiUrl": base, "turnstileSiteKey": key}
path = ROOT / "site" / "api-config.js"
path.write_text("window.PULSE_API_CONFIG = " + json.dumps(config) + ";\n", encoding="utf-8")
print("Generated public API config:", "live" if base else "legacy")
