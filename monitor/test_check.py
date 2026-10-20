"""Offline regression tests for the monitor's public status model."""
import datetime as dt
import unittest
from unittest.mock import patch

from monitor import check as m


class CatalogTests(unittest.TestCase):
    def test_unique_ids_and_categories(self):
        catalog = m.load_json(m.CATALOG, {})
        ids = [item["id"] for item in catalog["checks"]]
        self.assertEqual(len(ids), len(set(ids)))
        categories = {category["id"] for category in catalog["categories"]}
        self.assertGreaterEqual(len(categories), 10)
        for item in catalog["checks"]:
            self.assertIn(item["category"], categories)
            self.assertIn(item["kind"], {
                "http", "http_gateway", "tcp_tls", "requires_key",
                "music_rest", "music_ynison", "music_history", "music_queues"
            })
            if item["kind"] in {"http", "http_gateway"}:
                self.assertTrue(item["url"].startswith("https://"))

    def test_music_without_secret_has_no_account_data(self):
        probe = {"id": "music-rest", "kind": "music_rest"}
        result = m.optional_music_probe(probe, "", {})
        self.assertEqual(result["status"], "not_configured")
        self.assertNotIn("token", str(result).lower())

    def test_ynison_cooldown_is_respected_without_network(self):
        probe = {"id": "music-ynison", "kind": "music_ynison"}
        until = m.iso(m.utc_now() + dt.timedelta(minutes=58))
        previous = {"retry_after_at": until, "http_code": 503, "error_code": 500140000}
        with patch.dict("sys.modules", {"yandex_music": None}):
            result = m.optional_music_probe(probe, "placeholder-only-for-test", previous)
        self.assertEqual(result["status"], "cooldown")
        self.assertEqual(result["retry_after_at"], until)
        self.assertEqual(result["last_http_code"], 503)

    def test_http_503_is_not_success(self):
        probe = {"id": "example", "kind": "http", "url": "https://example.org/"}
        class FakeResponse:
            status = 503
            def __enter__(self): return self
            def __exit__(self, *args): return False
        with patch.object(m.urllib.request, "urlopen", return_value=FakeResponse()):
            item = m.http_probe(probe)
        self.assertEqual(item["status"], "down")
        self.assertEqual(item["http_code"], 503)

    def test_http_403_is_not_global_outage(self):
        probe = {"id": "example", "kind": "http", "url": "https://example.org/"}
        class FakeResponse:
            status = 403
            def __enter__(self): return self
            def __exit__(self, *args): return False
        with patch.object(m.urllib.request, "urlopen", return_value=FakeResponse()):
            item = m.http_probe(probe)
        self.assertEqual(item["status"], "degraded")


if __name__ == "__main__":
    unittest.main()
