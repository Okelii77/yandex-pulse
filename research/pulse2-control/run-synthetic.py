"""RC2 cloud smoke: standalone stdlib only; no native or legacy real API clients.
Only GitHub OIDC issuer and exact dedicated RC2 Worker are contacted.
"""
import datetime as dt
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

ROOT = pathlib.Path(__file__).resolve().parents[2]
DISABLED = {"music-ynison", "maps-geocoder", "ai-speech", "ai-vision"}
ORIGIN = "https://yandex-pulse-rc2.oleg-pulse-03.workers.dev"

def payload(catalog, now):
    assert len(catalog["checks"]) == 34
    assert len({c["id"] for c in catalog["checks"]}) == 34
    stamp = now.isoformat(timespec="seconds").replace("+00:00", "Z")
    rows = []
    for i, c in enumerate(catalog["checks"]):
        disabled = c["id"] in DISABLED
        rows.append({"id": c["id"], "status": "disabled" if disabled else ("degraded" if i % 11 == 0 else "ok"),
                     "checked_at": stamp, "latency_ms": None if disabled else 10 + i,
                     "reason": "SYNTHETIC FIXTURE — NOT A REAL YANDEX OBSERVATION"})
    assert sum(r["status"] == "disabled" for r in rows) == 4
    return dict(catalog, generated_at=stamp, data_mode="synthetic", results=rows)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def main():
    catalog = json.loads((ROOT / "monitor/services.json").read_text(encoding="utf-8"))
    if sys.argv[1:] == ["--self-test"]:
        p = payload(catalog, dt.datetime(2026, 11, 28, tzinfo=dt.timezone.utc))
        assert p["data_mode"] == "synthetic"
        assert len(p["results"]) == 34
        assert all("SYNTHETIC FIXTURE" in row["reason"] for row in p["results"])
        print("Synthetic fixture: 34 statuses, 30 measured fixtures, four disabled; zero network.")
        return
    if sys.argv[1:]:
        raise RuntimeError("unexpected arguments")
    if os.environ.get("PULSE_RC2_SYNTHETIC_ENABLED") != "1":
        raise RuntimeError("staging disabled")
    base = os.environ.get("PULSE_RC_API_URL", "").rstrip("/")
    if base != ORIGIN:
        raise RuntimeError("staging origin mismatch")
    opener = urllib.request.build_opener(NoRedirect)
    opener.addheaders = [("User-Agent", "YandexPulse-Core/2.0")]
    def get_json(req):
        with opener.open(req, timeout=20) as response:
            return json.load(response)
    health = get_json(urllib.request.Request(base + "/api/health"))
    if health.get("environment") != "staging" or health.get("mode") != "synthetic" or health.get("version") != "2.0.0-rc.2":
        raise RuntimeError("staging health mismatch")
    oidc = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    u = urlsplit(oidc)
    if u.scheme != "https" or not u.hostname or not u.hostname.endswith(".actions.githubusercontent.com") or u.username or u.password or u.fragment:
        raise RuntimeError("OIDC issuer URL not approved")
    req = urllib.request.Request(oidc + ("&" if "?" in oidc else "?") + "audience=yandex-pulse-rc-ingest",
                                 headers={"Authorization": "Bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})
    token = get_json(req)["value"]
    def post(path, data):
        assert path in ("/api/rc/acquire", "/api/rc/start", "/api/rc/ingest")
        return get_json(urllib.request.Request(base + path, data=json.dumps(data).encode(), method="POST",
                        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}))
    slot = os.environ.get("PULSE_RC_SLOT", "")
    lease = os.environ.get("PULSE_RC_LEASE", "")
    if bool(slot) != bool(lease) or (slot and (not re.fullmatch(r"[0-9]{13}", slot) or not re.fullmatch(r"[0-9a-f-]{36}", lease))):
        raise RuntimeError("invalid staging lease")
    try:
        claim = {"slot": int(slot), "token": lease} if slot else post("/api/rc/acquire", {})
        if post("/api/rc/start", {"claim": claim}).get("ok") is not True:
            raise RuntimeError("start rejected")
    except urllib.error.HTTPError as e:
        if e.code == 409:
            print("Synthetic slot skipped: already claimed or expired")
            return
        raise
    started = time.monotonic()
    data = payload(catalog, dt.datetime.now(dt.timezone.utc))
    print("RC synthetic fixture_ms", round((time.monotonic() - started) * 1000))
    started = time.monotonic()
    if post("/api/rc/ingest", {"claim": claim, "payload": data}).get("ok") is not True:
        raise RuntimeError("ingest rejected")
    print("RC synthetic snapshot accepted: 34 fixture statuses; upload_ms", round((time.monotonic() - started) * 1000))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("Synthetic staging failed:", type(e).__name__)
        sys.exit(1)
