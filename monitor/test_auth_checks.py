"""Offline safety and auth checks: no network and no token values in public output."""
import datetime as dt
import json
import os
import unittest
from unittest.mock import patch

from monitor import auth_checks


class AuthChecksTests(unittest.TestCase):
    def setUp(self):
        auth_checks.iam_token.cache_clear()

    def test_missing_disk_token(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch.object(auth_checks, "request_json", side_effect=AssertionError("network forbidden")):
                data = auth_checks.perform({"id":"disk-api"}, {})
        self.assertEqual(data["status"], "not_configured")

    def test_disk_is_read_only_and_no_secret_ever_returns(self):
        token = "TOP-SECRET-MOCK-TOKEN"
        def fake(url, headers, **_):
            self.assertEqual(url, "https://cloud-api.yandex.net/v1/disk")
            self.assertEqual(headers["Authorization"], "OAuth " + token)
            return 200, {"total_space": 1048576, "user": {"login": "private-email"}}
        with patch.dict(os.environ, {"YANDEX_DISK_TOKEN": token}, clear=True), \
             patch.object(auth_checks, "request_json", side_effect=fake):
            data = auth_checks.perform({"id":"disk-api"}, {})
        self.assertEqual(data["status"], "ok")
        self.assertNotIn(token, json.dumps(data))
        self.assertNotIn("private-email", json.dumps(data))

    def test_wiki_requires_id_slug_and_token(self):
        with patch.dict(os.environ, {"YANDEX_WIKI_TOKEN":"private"}, clear=True):
            data = auth_checks.perform({"id":"wiki-api"}, {})
        self.assertEqual(data["status"], "not_configured")
        self.assertIn("YANDEX_WIKI_ORG_ID", data["reason"])

    def test_wiki_metadata_response(self):
        with patch.dict(os.environ, {"YANDEX_WIKI_TOKEN":"test",
             "YANDEX_WIKI_ORG_ID":"org", "YANDEX_WIKI_TEST_SLUG":"test/page"}, clear=True), \
             patch.object(auth_checks, "request_json", return_value=(200,{"id":31,"title":"Secret"})) as mock:
            data = auth_checks.perform({"id":"wiki-api"}, {})
        self.assertEqual(data["status"], "ok")
        self.assertIn("test%2Fpage", mock.call_args.args[0])
        self.assertNotIn("Secret", json.dumps(data))

    def test_cloud_iam_requires_key_and_folder(self):
        with patch.dict(os.environ, {"YC_FOLDER_ID":"folder"}, clear=True):
            data = auth_checks.perform({"id":"cloud-iam"}, {})
        self.assertEqual(data["status"], "not_configured")

    def test_monitoring_read_only(self):
        with patch.dict(os.environ, {"YC_FOLDER_ID":"folder-id",
             "YC_MONITORING_API_KEY":"monitor-secret"}, clear=True), \
             patch.object(auth_checks, "request_json", return_value=(200,{"metrics":[]})) as mock:
            data = auth_checks.perform({"id":"cloud-monitoring"}, {})
        self.assertEqual(data["status"], "ok")
        self.assertEqual(mock.call_args.args[1]["Authorization"], "Api-Key monitor-secret")
        self.assertNotIn("monitor-secret", str(data))

    def test_ai_models_is_readonly(self):
        with patch.dict(os.environ, {"YC_FOLDER_ID":"folder","YC_AI_API_KEY":"hidden"}, clear=True), \
             patch.object(auth_checks, "request_json", return_value=(200,{"data":[]})) as mock:
            data = auth_checks.perform({"id":"ai-models"}, {})
        self.assertEqual(data["status"], "ok")
        self.assertEqual(mock.call_args.args[0],"https://ai.api.cloud.yandex.net/v1/models")
        self.assertNotIn("hidden",str(data))

    def test_paid_never_runs_without_opt_in(self):
        for cid,key in (("maps-geocoder","YANDEX_MAPS_API_KEY"),
                        ("ai-speech","YC_SPEECHKIT_API_KEY"),
                        ("ai-vision","YC_VISION_API_KEY")):
            env={key:"secret","YC_FOLDER_ID":"folder"}
            with patch.dict(os.environ,env,clear=True),\
                 patch.object(auth_checks,"request_json",side_effect=AssertionError("paid network call forbidden")):
                data=auth_checks.perform({"id":cid},{})
            self.assertEqual(data["status"],"disabled")

    def test_paid_opt_in_obeys_24h_backoff(self):
        until=auth_checks.iso(auth_checks.now()+dt.timedelta(hours=12))
        env={"PULSE_ENABLE_BILLABLE_PROBES":"1","YANDEX_MAPS_API_KEY":"some-key"}
        with patch.dict(os.environ,env,clear=True),\
             patch.object(auth_checks,"request_json",side_effect=AssertionError("paid call before cooldown")):
            data=auth_checks.perform({"id":"maps-geocoder"},{"retry_after_at":until})
        self.assertEqual(data["status"],"cooldown")

    def test_http_rejects_private_error_detail(self):
        with patch.dict(os.environ,{"YANDEX_DISK_TOKEN":"TOKEN"},clear=True),\
             patch.object(auth_checks,"request_json",return_value=(403,{"message":"TOKEN leaked"})):
            data=auth_checks.perform({"id":"disk-api"},{})
        self.assertEqual(data["status"],"down")
        self.assertNotIn("TOKEN",json.dumps(data))

    def test_test_image_is_valid_png(self):
        content=auth_checks.minimal_png()
        self.assertTrue(content.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertLess(len(content),20000)


if __name__=="__main__":
    unittest.main()
