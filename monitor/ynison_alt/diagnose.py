"""Pinned MarshalX one-shot diagnostic. No raw frames or credentials are published."""
import json
import logging
import os
import re
import time
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone

API = "https://yandex-pulse-api.oleg-pulse-03.workers.dev"
HOST = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+yandex\.(?:ru|net)(?::443)?", re.I)
def valid_host(host):
    return isinstance(host, str) and HOST.fullmatch(host) is not None

def field(obj, snake, camel):
    if not isinstance(obj, dict):
        return None
    return obj.get(snake) if obj.get(snake) is not None else obj.get(camel)

def integer(x):
    if isinstance(x, bool):
        return None
    if isinstance(x, int):
        return x if abs(x) <= 2**53-1 else None
    if isinstance(x, str) and re.fullmatch(r"-?\d{1,20}", x):
        return integer(int(x))
    return None

def classify_state(frame):
    if not isinstance(frame, dict) or "error" in frame:
        return None
    p = field(frame, "player_state", "playerState")
    q = field(p, "player_queue", "playerQueue")
    s = p.get("status") if isinstance(p, dict) else None
    if not isinstance(q, dict) or not isinstance(s, dict):
        return None
    paused = s.get("paused")
    duration = field(s, "duration_ms", "durationMs")
    progress = field(s, "progress_ms", "progressMs")
    if paused is not None and not isinstance(paused, bool):
        return None
    if any(n is not None and (integer(n) is None or integer(n) < 0) for n in (duration, progress)):
        return None
    if paused is None and duration is None and progress is None:
        return None
    entries = field(q, "playable_list", "playableList")
    raw_index = field(q, "current_playable_index", "currentPlayableIndex")
    idx = 0 if raw_index is None else integer(raw_index)
    if (entries is not None and not isinstance(entries, list)) or idx is None or idx < -1:
        return None
    if idx == -1:
        return "no_data"
    if entries == []:
        return "no_data" if idx == 0 else None
    if not isinstance(entries, list) or idx >= len(entries):
        return None
    playable = field(entries[idx], "playable_id", "playableId")
    return "ok" if isinstance(playable, str) and playable.strip() else None

def gate(path, body):
    url = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    sep = "&" if "?" in url else "?"
    req = urllib.request.Request(url + sep + "audience=yandex-pulse-ynison",
        headers={"Authorization": "Bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})
    with urllib.request.urlopen(req, timeout=8) as resp:
        token = json.loads(resp.read(30000))["value"]
    request = urllib.request.Request(API + "/api/ynison/" + path,
        data=json.dumps(body).encode(), headers={"Authorization":"Bearer " + token,"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(request, timeout=8) as resp:
            return resp.status, json.loads(resp.read(8192))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read(8192))

def probe(token):
    from yandex_music.ynison.client import YnisonClient
    from yandex_music.exceptions import YnisonError
    logging.disable(logging.CRITICAL)
    class GuardedClient(YnisonClient):
        verified = None
        def _parse_redirect_frame(self, message):
            result = super()._parse_redirect_frame(message)
            if not valid_host(result.host):
                raise YnisonError("invalid redirect host")
            return result
        def _parse_state_frame(self, message):
            raw = json.loads(message)
            if isinstance(raw, dict) and "error" in raw:
                return super()._parse_state_frame(message)
            classification = classify_state(raw)
            if classification is None:
                raise YnisonError("invalid state frame")
            result = super()._parse_state_frame(message)
            self.verified = classification
            return result
    client = GuardedClient(token, device_title="Yandex Pulse", max_reconnect_attempts=0)
    try:
        with client.session(timeout=20):
            return {"status":client.verified or "unknown","stage":"validated_raw_state" if client.verified else "state"}
    except Exception as exc:
        result = {"status":"error","stage":"client"}
        for key in ("http_code","grpc_code","error_code"):
            value = integer(getattr(exc,key,None))
            if value is not None and 0 <= value < 10**10:
                result[key] = value
        away = getattr(exc,"go_away_seconds",None)
        if away is not None:
            n = integer(away)
            if n is not None and 0 < n <= 315360000:
                result["retry_after_seconds"] = n
            elif away != 0:
                result["status"] = "unknown"
        # No log of exception text. Unknown transport/cleanup is conservative.
        if "retry_after_seconds" not in result and not any(k in result for k in ("http_code","grpc_code","error_code")):
            result["status"] = "unknown"
        return result

def run():
    token = os.environ.get("YANDEX_MUSIC_TOKEN","").strip()
    if not token:
        return {"status":"not_configured","stage":"secret"}
    try:
        code, data = gate("acquire",{"client":"python"})
    except Exception:
        return {"status":"preflight_failed","stage":"gate"}
    if code == 429:
        return {"status":"cooldown","stage":"gate","retry_after_at":data.get("retry_after_at")}
    if code != 200 or data.get("ok") is not True or not isinstance(data.get("lease_id"),str):
        return {"status":"preflight_failed","stage":"gate"}
    try:
        result = probe(token)
    except Exception:
        result = {"status":"unknown","stage":"diagnostic"}
    try:
        body = {"lease_id":data["lease_id"],"outcome":result["status"]}
        if "retry_after_seconds" in result:
            body["retry_after_seconds"] = result["retry_after_seconds"]
        code, final = gate("finish",body)
        if code != 200 or final.get("ok") is not True:
            raise ValueError("finish")
        result["retry_after_at"] = final["retry_after_at"]
        result["gate"] = "recorded"
    except Exception:
        result["gate"] = "finish_failed_crash_cooldown"
    return result

if __name__ == "__main__":
    start = time.monotonic()
    report = {"client":"MarshalX yandex-music 3.2.2","checked_at":datetime.now(timezone.utc).isoformat(),**run()}
    report["duration_ms"] = round((time.monotonic()-start)*1000)
    Path("ynison-diagnostic.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"],"a",encoding="utf-8") as f:
            f.write("## Ynison Python diagnostic\n\nStatus: "+report["status"]+"; stage: "+report["stage"]+"\n")
    print("Ynison diagnostic:",report["status"],report["stage"])
    if report.get("gate") == "finish_failed_crash_cooldown" or report["status"] == "preflight_failed":
        raise SystemExit(1)
