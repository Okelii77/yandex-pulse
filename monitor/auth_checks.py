"""Safe read-only and explicitly opt-in paid API checks for Yandex Pulse.

Credentials never enter JSON output or logs. Network targets are fixed and
do not follow cross-origin redirects with Authorization headers. Paid
synthetic actions default OFF and are capped at one per service per 24 hours.
"""
from __future__ import annotations

import base64
import datetime as dt
import functools
import json
import os
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from typing import Any

API_TIMEOUT = 12
MAX_BODY = 384 * 1024
DAY = 86400


def iso(value):
    return value.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def date_from(value):
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None
    except (ValueError, TypeError, AttributeError):
        return None


def now():
    return dt.datetime.now(dt.timezone.utc)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Do not forward OAuth/API keys to another origin, ever.
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def request_json(url, headers=None, payload=None, binary=False, method=None):
    """Return status code and small decoded JSON, never publish response content."""
    if not url.startswith("https://"):
        raise ValueError("HTTPS required")
    head = {"User-Agent": "YandexPulseStatusMonitor/1.1", "Accept": "application/json"}
    if headers:
        head.update(headers)
    body = None
    if payload is not None:
        body = payload if binary else json.dumps(payload, separators=(",", ":")).encode("utf-8")
        if not binary:
            head["Content-Type"] = "application/json"
        else:
            head["Content-Type"] = "application/octet-stream"
    req = urllib.request.Request(url, headers=head, data=body, method=method or ("POST" if body is not None else "GET"))
    try:
        with OPENER.open(req, timeout=API_TIMEOUT) as response:
            code = response.status
            data = response.read(MAX_BODY + 1)
    except urllib.error.HTTPError as error:
        code = error.code
        # Never read error body: it can include account metadata or secrets.
        return code, None
    if len(data) > MAX_BODY:
        return code, None
    try:
        return code, json.loads(data) if data else None
    except (ValueError, UnicodeDecodeError):
        return code, None


def env(name):
    return os.environ.get(name, "").strip()


def result(check, status, latency_ms=None, **extras):
    data = {"id": check["id"], "status": status, "checked_at": iso(now()), "latency_ms": latency_ms}
    data.update(extras)
    return data


def needs(check, *items):
    absent = [name for name, value in items if not value]
    if absent:
        return result(check, "not_configured", reason="Требуется: " + ", ".join(absent))
    return None


def state_for_http(code):
    if code in (401, 403):
        return "down", "Авторизация или права отклонены"
    if code == 429:
        return "degraded", "API ограничил частоту запросов"
    if code in (408, 409):
        return "degraded", "Запрос не может быть выполнен сейчас"
    if code in (301, 302, 303, 307, 308):
        return "degraded", "API вернул перенаправление"
    if code >= 500:
        return "down", "Сервер ответил ошибкой"
    return "degraded", "API отклонил параметры запроса"


@functools.lru_cache(maxsize=1)
def iam_token():
    """Short-lived token or fresh IAM token via a scoped service account key.

    For public open-source deployments, workload identity federation is safer
    than an exportable service account private key; both are opt-in.
    """
    fixed = env("YC_IAM_TOKEN")
    if fixed:
        return fixed
    raw = env("YC_SERVICE_ACCOUNT_KEY_JSON")
    if not raw:
        return ""
    key = json.loads(raw)
    import jwt
    timestamp = int(time.time())
    payload = {
        "aud": "https://iam.api.cloud.yandex.net/iam/v1/tokens",
        "iss": key["service_account_id"],
        "iat": timestamp,
        "exp": timestamp + 1200,
    }
    signed = jwt.encode(payload, key["private_key"], algorithm="PS256", headers={"kid": key["id"]})
    code, data = request_json("https://iam.api.cloud.yandex.net/iam/v1/tokens", payload={"jwt": signed})
    if code != 200 or not isinstance(data, dict) or not data.get("iamToken"):
        raise RuntimeError("IAM exchange rejected")
    return data["iamToken"]


def recognized(check, code, data, expected, note):
    """Only a structurally valid successful response gets the green indicator."""
    if code == 200 and isinstance(data, dict) and expected in data:
        return "ok", note
    if code == 200:
        return "degraded", "API ответил, но формат данных не подтвердился"
    return state_for_http(code)


def minimal_png():
    """Generate a static 96x48 monochrome test image reading 'HI'."""
    w, h = 96, 48
    pixels = [bytearray([255, 255, 255] * w) for _ in range(h)]
    def black(x, y):
        if 0 <= x < w and 0 <= y < h:
            pixels[y][x * 3:x * 3+3] = b"\x00\x00\x00"
    for y in range(11, 37):
        for stroke in range(4):
            for x in (18+stroke, 39+stroke, 58+stroke):
                black(x, y)
    for y in range(22, 26):
        for x in range(18, 43):
            black(x, y)
    for y in list(range(11, 15)) + list(range(33, 37)):
        for x in range(58, 77):
            black(x, y)
    raw = b"".join(b"\x00" + bytes(p) for p in pixels)
    def chunk(tag, val):
        return struct.pack(">I", len(val)) + tag + val + struct.pack(">I", zlib.crc32(tag + val) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">2I5B", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def billable_gate(check, previous):
    """No paid probes from simply adding a key. Once/day maximum when opted in."""
    if env("PULSE_ENABLE_BILLABLE_PROBES") != "1":
        return result(check, "disabled", reason="Платные запросы отключены; включите PULSE_ENABLE_BILLABLE_PROBES=1")
    retry_at = date_from(previous.get("retry_after_at"))
    if retry_at and now() < retry_at:
        return result(check, "cooldown", reason="Проверка не чаще одного раза за 24 часа", retry_after_at=iso(retry_at),
                      last_http_code=previous.get("http_code"))
    return None


def perform(check, previous):
    """Run a single service-specific check, with no credentials in public payload."""
    cid = check["id"]
    started = time.monotonic()
    code = None
    extras = {}
    previous = previous or {}
    try:
        folder = env("YC_FOLDER_ID")
        if cid == "disk-api":
            token = env("YANDEX_DISK_TOKEN")
            if missing := needs(check, ("YANDEX_DISK_TOKEN", token)):
                return missing
            code, data = request_json("https://cloud-api.yandex.net/v1/disk", {"Authorization": "OAuth " + token})
            status, note = recognized(check, code, data, "total_space", "Disk REST: метаданные получены (не опубликованы)")
        elif cid == "wiki-api":
            token = env("YANDEX_WIKI_TOKEN")
            org = env("YANDEX_WIKI_ORG_ID")
            slug = env("YANDEX_WIKI_TEST_SLUG")
            if missing := needs(check, ("YANDEX_WIKI_TOKEN", token), ("YANDEX_WIKI_ORG_ID", org),
                                ("YANDEX_WIKI_TEST_SLUG", slug)):
                return missing
            # Only request page metadata, never its content.
            url = "https://api.wiki.yandex.net/v1/pages?slug=" + urllib.parse.quote(slug.strip("/"), safe="")
            code, data = request_json(url, {"Authorization": "OAuth " + token, "X-Org-Id": org})
            if code == 404:
                status, note = "no_data", "Тестовая страница отсутствует или недоступна"
            else:
                status, note = recognized(check, code, data, "id", "Wiki: метаданные тестовой страницы получены")
        elif cid in ("cloud-iam", "cloud-monitoring"):
            is_monitoring = cid == "cloud-monitoring"
            monitoring_key = env("YC_MONITORING_API_KEY") if is_monitoring else ""
            if missing := needs(check, ("YC_FOLDER_ID", folder)):
                return missing
            if not monitoring_key and not (env("YC_IAM_TOKEN") or env("YC_SERVICE_ACCOUNT_KEY_JSON")):
                return result(check, "not_configured", reason="Требуется YC_IAM_TOKEN / YC_SERVICE_ACCOUNT_KEY_JSON" +
                              (" или YC_MONITORING_API_KEY" if is_monitoring else ""))
            headers = {"Authorization": ("Api-Key " + monitoring_key if monitoring_key
                                         else "Bearer " + iam_token())}
            if is_monitoring:
                url = "https://monitoring.api.cloud.yandex.net/monitoring/v2/metrics?folderId=" + urllib.parse.quote(folder, safe="")
                code, data = request_json(url, headers)
                status, note = recognized(check, code, data, "metrics", "Monitoring: список метрик доступен")
            else:
                url = "https://iam.api.cloud.yandex.net/iam/v1/serviceAccounts?folderId=" + urllib.parse.quote(folder, safe="") + "&pageSize=1"
                code, data = request_json(url, headers)
                status, note = recognized(check, code, data, "serviceAccounts", "IAM: список сервисных аккаунтов доступен")
        elif cid == "ai-models":
            key = env("YC_AI_API_KEY")
            if missing := needs(check, ("YC_AI_API_KEY", key), ("YC_FOLDER_ID", folder)):
                return missing
            code, data = request_json("https://ai.api.cloud.yandex.net/v1/models",
                {"Authorization": "Api-Key " + key, "x-project": folder})
            status, note = recognized(check, code, data, "data", "AI Studio: список моделей доступен (без генерации)")
        elif cid in ("maps-geocoder", "ai-speech", "ai-vision"):
            keyname = {"maps-geocoder": "YANDEX_MAPS_API_KEY", "ai-speech": "YC_SPEECHKIT_API_KEY",
                       "ai-vision": "YC_VISION_API_KEY"}[cid]
            key = env(keyname)
            optional_folder = [] if cid == "maps-geocoder" else [("YC_FOLDER_ID", folder)]
            if missing := needs(check, (keyname, key), *optional_folder):
                return missing
            if wait := billable_gate(check, previous):
                return wait
            # Persist next allowed time even if request fails. Never auto-retry paid calls.
            extras["retry_after_at"] = iso(now() + dt.timedelta(seconds=DAY))
            if cid == "maps-geocoder":
                query = urllib.parse.urlencode({"apikey": key, "geocode": "Москва", "format": "json", "results": "1"})
                code, data = request_json("https://geocode-maps.yandex.ru/v1/?" + query)
                status, note = recognized(check, code, data, "response", "Геокодер: тестовый адрес обработан")
            elif cid == "ai-speech":
                # One second silent LPCM, no user audio, may be billed as recognition.
                query = urllib.parse.urlencode({"format": "lpcm", "sampleRateHertz": "16000", "lang": "ru-RU",
                                                 "folderId": folder})
                code, data = request_json("https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?" + query,
                    {"Authorization": "Api-Key " + key}, payload=b"\x00\x00" * 16000, binary=True)
                status, note = recognized(check, code, data, "result", "SpeechKit: синтетический аудиозапрос обработан")
            else:
                payload = {"mimeType": "PNG", "languageCodes": ["*"], "model": "page",
                           "content": base64.b64encode(minimal_png()).decode("ascii")}
                code, data = request_json("https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText",
                    {"Authorization": "Api-Key " + key, "x-folder-id": folder}, payload=payload)
                status, note = recognized(check, code, data, "result", "Vision OCR: синтетическое изображение обработано")
        else:
            return result(check, "not_configured", reason="Проверка пока не поддерживается")
        latency = int((time.monotonic() - started) * 1000)
        # Status/errors only, not account data, key values, URL or remote bodies.
        return result(check, status, latency, http_code=code, note=note, **extras)
    except Exception as exc:
        latency = int((time.monotonic() - started) * 1000)
        # Strict error type allowlist: even exception strings may contain keys/URLs.
        return result(check, "down", latency, reason=type(exc).__name__[:50], **extras)
