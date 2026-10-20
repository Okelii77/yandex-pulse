#!/usr/bin/env python3
"""Yandex Pulse: public reachability and opt-in authenticated probes.

No account data, access tokens, response bodies, or exception text are published.
A green HTTP probe means *endpoint reachable*, not that the entire service works.
"""
from __future__ import annotations

import concurrent.futures
import datetime as dt
import json
import os
import pathlib
import socket
import ssl
import time
import urllib.error
import urllib.request
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
CATALOG = ROOT / "monitor" / "services.json"
SITE = ROOT / "site"
STATUS_FILE = SITE / "status.json"
HISTORY_FILE = SITE / "history.json"
HEADERS = {"User-Agent": "YandexPulseStatusMonitor/1.0 (+github.com/Okelii77/yandex-pulse)", "Accept": "text/html,application/json;q=0.9,*/*;q=0.5"}
TIMEOUT = 9
RETENTION_DAYS = 30
UTC = dt.timezone.utc


def utc_now() -> dt.datetime:
    return dt.datetime.now(UTC)


def iso(value: dt.datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def from_iso(value: str | None) -> dt.datetime | None:
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None
    except (ValueError, TypeError):
        return None


def load_json(path: pathlib.Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback


def atomic_json(path: pathlib.Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def result(check: dict, state: str, latency: int | None = None, **extras: Any) -> dict:
    data = {"id": check["id"], "status": state, "checked_at": iso(utc_now()), "latency_ms": latency}
    data.update(extras)
    return data


def http_probe(check: dict) -> dict:
    started = time.monotonic()
    code = None
    try:
        req = urllib.request.Request(check["url"], headers=HEADERS, method="GET")
        with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
            code = response.status
    except urllib.error.HTTPError as exc:
        code = exc.code
    except Exception as exc:
        elapsed = int((time.monotonic() - started) * 1000)
        # Never copy remote errors into the public JSON.
        return result(check, "down", elapsed, reason=type(exc).__name__[:60])

    elapsed = int((time.monotonic() - started) * 1000)
    if 200 <= code < 400:
        state = "ok"
    elif code in (401, 403, 404, 429):
        # A blocked, auth-gated, or unknown route cannot verify service health.
        state = "degraded"
    else:
        state = "down" if code >= 500 else "unknown"

    if check["kind"] == "http_gateway" and code in (401, 403):
        # Expected anonymous S3 request denial proves gateway response, not object access.
        state = "degraded"
    return result(check, state, elapsed, http_code=code)


def tls_probe(check: dict) -> dict:
    started = time.monotonic()
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((check["host"], int(check["port"])), timeout=TIMEOUT) as sock:
            sock.settimeout(TIMEOUT)
            with ctx.wrap_socket(sock, server_hostname=check["host"]):
                pass
        elapsed = int((time.monotonic() - started) * 1000)
        return result(check, "ok", elapsed, transport="tls")
    except Exception as exc:
        elapsed = int((time.monotonic() - started) * 1000)
        return result(check, "down", elapsed, reason=type(exc).__name__[:60])


def optional_music_probe(check: dict, token: str, previous: dict) -> dict:
    if not token:
        return result(check, "not_configured", reason="YANDEX_MUSIC_TOKEN не задан")

    if check["kind"] == "music_ynison":
        # A remote go-away request persists across scheduled workflow runs.
        retry_at = from_iso(previous.get("retry_after_at"))
        if retry_at and utc_now() < retry_at:
            return result(check, "cooldown", reason="Соблюдаем паузу Ynison", retry_after_at=iso(retry_at),
                          last_http_code=previous.get("http_code"),
                          last_error_code=previous.get("error_code"))

    started = time.monotonic()
    try:
        from yandex_music import Client

        if check["kind"] == "music_ynison":
            from yandex_music.ynison import simple
            state = simple.get_state(token, timeout=12)
            elapsed = int((time.monotonic() - started) * 1000)
            active = getattr(state, "active_device_id_optional", None)
            # Never serialize track IDs, device IDs or user details.
            return result(check, "ok" if active else "no_data", elapsed,
                          note="Состояние получено" if active else "Активное устройство не найдено")

        client = Client(token).init()
        if check["kind"] == "music_rest":
            status = "ok"
            note = "Авторизованный запрос выполнен"
        elif check["kind"] == "music_history":
            response = client.music_history(full_models_count=1)
            status = "ok" if response else "no_data"
            note = "История доступна" if response else "История пуста"
        elif check["kind"] == "music_queues":
            queues = client.queues_list()
            status = "ok" if queues else "no_data"
            note = "Очереди получены" if queues else "Список очередей пуст"
        else:
            return result(check, "unknown", reason="Тип проверки не реализован")
        return result(check, status, int((time.monotonic() - started) * 1000), note=note)

    except Exception as exc:
        elapsed = int((time.monotonic() - started) * 1000)
        safe = {"reason": type(exc).__name__[:80]}
        if check["kind"] == "music_ynison":
            for key in ("http_code", "grpc_code", "error_code"):
                value = getattr(exc, key, None)
                # Only small integral error codes, no verbose server text.
                if isinstance(value, int):
                    safe[key] = value
                elif isinstance(value, str) and value.isdigit() and len(value) < 12:
                    safe[key] = int(value)
            go_away = getattr(exc, "go_away_seconds", 0)
            if isinstance(go_away, int) and 0 < go_away <= 86400:
                safe["retry_after_at"] = iso(utc_now() + dt.timedelta(seconds=go_away))
        return result(check, "down", elapsed, **safe)


def run() -> dict:
    catalog = load_json(CATALOG, {})
    checks = catalog["checks"]
    previous = load_json(STATUS_FILE, {})
    old_results = {r["id"]: r for r in previous.get("results", []) if isinstance(r, dict) and "id" in r}
    token = os.environ.get("YANDEX_MUSIC_TOKEN", "").strip()
    results: dict[str, dict] = {}

    public = [item for item in checks if item["kind"] in ("http", "http_gateway", "tcp_tls")]
    print("Yandex Pulse: checking", len(public), "public endpoints")
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {
            pool.submit(tls_probe if item["kind"] == "tcp_tls" else http_probe, item): item
            for item in public
        }
        for future in concurrent.futures.as_completed(futures):
            item = futures[future]
            try:
                results[item["id"]] = future.result()
            except Exception as exc:
                results[item["id"]] = result(item, "down", reason=type(exc).__name__)

    try:
        from monitor.auth_checks import perform as auth_probe
    except ImportError:
        from auth_checks import perform as auth_probe

    for item in checks:
        if item["id"] in results:
            continue
        previous_result = old_results.get(item["id"], {})
        if item["kind"] == "requires_key":
            results[item["id"]] = auth_probe(item, previous_result)
        else:
            results[item["id"]] = optional_music_probe(item, token, previous_result)

    ordered = [results[item["id"]] for item in checks]
    now = utc_now()
    payload = {
        "schema": 1,
        "generated_at": iso(now),
        "interval_minutes": catalog.get("interval_minutes", 30),
        "scope": "Synthetic probes from GitHub Actions; NOT official Yandex service status.",
        "categories": catalog["categories"],
        "checks": checks,
        "results": ordered,
    }

    history = load_json(HISTORY_FILE, {"schema": 1, "series": {}})
    series = history.get("series", {})
    if not isinstance(series, dict):
        series = {}
    cutoff = now - dt.timedelta(days=RETENTION_DAYS)
    for row in ordered:
        key = row["id"]
        points = series.get(key, [])
        if not isinstance(points, list):
            points = []
        points = [p for p in points if isinstance(p, list) and len(p) == 3
                  and (stamp := from_iso(p[0])) and stamp >= cutoff]
        # Unknown, not configured and cooldown are not synthetic probe measurements.
        if row["status"] in ("ok", "degraded", "down", "no_data"):
            points.append([row["checked_at"], row["status"], row.get("latency_ms")])
        series[key] = points[-1500:]
    atomic_json(STATUS_FILE, payload)
    atomic_json(HISTORY_FILE, {"schema": 1, "retention_days": RETENTION_DAYS, "series": series})
    summary = {}
    for row in ordered:
        summary[row["status"]] = summary.get(row["status"], 0) + 1
    print("Probe result counts:", summary)
    print("Site JSON written. Authentication details were NOT exported.")
    return payload


if __name__ == "__main__":
    run()
