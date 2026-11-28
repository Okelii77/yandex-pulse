"""RC2 cloud smoke: standalone stdlib only; no native or legacy real API clients.
Only GitHub OIDC issuer and exact dedicated RC2 Worker are contacted.
"""
import base64
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

# Never log arbitrary response bodies, headers, URLs, JWTs, or exceptions.
OPERATIONS = {"health", "oidc", "acquire", "start", "ingest"}
ERROR_CODES = {"unauthorized", "staging_disabled", "busy_or_budget", "staging_budget_exhausted",
               "invalid_or_unavailable", "mode_mismatch", "too_large", "not_found", "waiting", "scheduled_lease_unavailable"}
EXPECTED_CLAIMS = {
    "iss": "https://token.actions.githubusercontent.com",
    "aud": "yandex-pulse-rc-ingest",
    "repository": "Okelii77/yandex-pulse",
    "repository_id": "1427282907",
    "repository_owner_id": "108305520",
    "ref": "refs/heads/research/pulse-architecture-20261128",
    "environment": "pulse-rc",
    "event_name": "workflow_dispatch",
    "workflow_ref": "Okelii77/yandex-pulse/.github/workflows/pulse2-rc-dispatch.yml@refs/heads/research/pulse-architecture-20261128",
    "sub": "repo:Okelii77@108305520/yandex-pulse@1427282907:environment:pulse-rc",
}

def event(operation, **fields):
    assert operation in OPERATIONS
    print("RC2_HTTP", json.dumps({"operation": operation, **fields}, sort_keys=True), flush=True)

def error_fields(status, headers, body):
    out = {"status": status}
    ray = headers.get("CF-Ray", "")
    if re.fullmatch(r"[0-9a-fA-F]{16,32}(?:-[A-Z]{3})?", ray):
        out["cf_ray"] = ray
    retry = headers.get("Retry-After", "")
    if re.fullmatch(r"[0-9]{1,8}", retry):
        out["retry_after_seconds"] = int(retry)
    if status == 403 and re.fullmatch(rb"\s*error code: 1010\s*", body):
        out["cloudflare_code"] = 1010
    try:
        obj = json.loads(body)
        if isinstance(obj, dict):
            if isinstance(obj.get("error"), str) and obj["error"] in ERROR_CODES:
                out["error"] = obj["error"]
            if obj.get("ok") is False:
                out["ok"] = False
    except (ValueError, UnicodeError):
        pass
    return out

def check_claims(token):
    # Diagnostic only: server remains responsible for cryptographic verification.
    # Emit booleans, never actual token claim values or identifiers such as jti.
    parts = token.split(".")
    if len(parts) != 3 or len(token) > 12000:
        raise RuntimeError("invalid JWT shape")
    def decode(part):
        return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    header, claims = decode(parts[0]), decode(parts[1])
    now = int(time.time())
    result = {k: (str(claims.get(k)) == v if k.endswith("_id") else claims.get(k) == v)
              for k, v in EXPECTED_CLAIMS.items()}
    result["alg"] = header.get("alg") == "RS256"
    result["kid"] = bool(header.get("kid"))
    jti = claims.get("jti")
    result["jti"] = isinstance(jti, str) and bool(re.fullmatch(r"[A-Za-z0-9_-]{8,128}", jti))
    result["run_id"] = str(claims.get("run_id")) == os.environ.get("GITHUB_RUN_ID")
    result["run_attempt"] = str(claims.get("run_attempt")) == os.environ.get("GITHUB_RUN_ATTEMPT")
    result["job_workflow_ref"] = not claims.get("job_workflow_ref") or claims["job_workflow_ref"] == claims.get("workflow_ref")
    exp, iat, nbf = (claims.get(k) for k in ("exp", "iat", "nbf"))
    result["time"] = all(type(x) is int for x in (exp, iat, nbf)) and now < exp <= now+600 and now-600 <= iat <= now+30 and 0 < exp-iat <= 600 and nbf <= now+30
    print("RC2_OIDC_MATCH", json.dumps(result, sort_keys=True), flush=True)
    if not all(result.values()):
        raise RuntimeError("OIDC claims mismatch")
    return result

def get_json(opener, operation, req):
    event(operation, phase="begin")
    started = time.monotonic()
    try:
        with opener.open(req, timeout=20) as response:
            data = json.load(response)
            event(operation, phase="success", status=response.status, elapsed_ms=round((time.monotonic()-started)*1000))
            return data
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read(8192)
        except Exception:
            body = b""
        event(operation, phase="failure", **error_fields(exc.code, exc.headers, body))
        raise
    except Exception as exc:
        event(operation, phase="failure", kind=type(exc).__name__)
        raise

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
    health = get_json(opener, "health", urllib.request.Request(base + "/api/health"))
    if health.get("environment") != "staging" or health.get("mode") != "synthetic" or health.get("version") != "2.0.0-rc.2":
        raise RuntimeError("staging health mismatch")
    oidc = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    u = urlsplit(oidc)
    if u.scheme != "https" or not u.hostname or not u.hostname.endswith(".actions.githubusercontent.com") or u.username or u.password or u.fragment:
        raise RuntimeError("OIDC issuer URL not approved")
    def fresh_token():
        req = urllib.request.Request(oidc + ("&" if "?" in oidc else "?") + "audience=yandex-pulse-rc-ingest",
                                     headers={"Authorization": "Bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})
        token = get_json(opener, "oidc", req)["value"]
        check_claims(token)
        return token
    def post(path, data):
        assert path in ("/api/rc/acquire", "/api/rc/start", "/api/rc/ingest")
        return get_json(opener, path.rsplit('/', 1)[-1], urllib.request.Request(base + path, data=json.dumps(data).encode(), method="POST",
                        headers={"Authorization": "Bearer " + fresh_token(), "Content-Type": "application/json"}))
    slot = os.environ.get("PULSE_RC_SLOT", "")
    lease = os.environ.get("PULSE_RC_LEASE", "")
    if (lease and not slot) or (slot and not re.fullmatch(r"[0-9]{13}", slot)) or (lease and not re.fullmatch(r"[0-9a-f-]{36}", lease)):
        raise RuntimeError("invalid staging lease")
    try:
        if slot and not lease:
            # Bounded wait for the dispatch response to be committed; fresh OIDC for each attempt.
            for attempt in range(3):
                try:
                    claim = post("/api/rc/acquire", {"slot": int(slot)})
                    break
                except urllib.error.HTTPError as exc:
                    if exc.code != 409 or attempt == 2:raise
                    time.sleep(2)
        else:
            claim = {"slot": int(slot), "token": lease} if slot else post("/api/rc/acquire", {})
        if post("/api/rc/start", {"claim": claim}).get("ok") is not True:
            raise RuntimeError("start rejected")
    except urllib.error.HTTPError:
        # A denied acquire/start is not a successful publication.
        raise
    started = time.monotonic()
    import runpy
    native=runpy.run_path(str(ROOT / 'research/pulse2-control/run-rust-fixture.py'))['run'](catalog)
    data = payload(catalog, dt.datetime.now(dt.timezone.utc))
    measured={r['id']:r for r in native}
    for row in data['results']:
        if row['id'] in measured:
            row.update(measured[row['id']],reason='SYNTHETIC LOOPBACK NATIVE CORE — NOT YANDEX')
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
