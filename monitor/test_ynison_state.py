import importlib.util
import json
import unittest
from pathlib import Path
root=Path(__file__).parent/"ynison_alt"
spec=importlib.util.spec_from_file_location("ynison_diagnose",root/"diagnose.py")
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class YnisonStateTests(unittest.TestCase):
    def test_shared_state_fixtures(self):
        for case in json.loads((root/"state-fixtures.json").read_text()):
            with self.subTest(case=case["name"]):
                self.assertEqual(module.classify_state(case["frame"]),case["expected"])
    def test_redirect_hosts(self):
        self.assertTrue(module.valid_host("node.music.yandex.net:443"))
        for host in ("evil.test","foo.yandex.ru@evil.test","foo.yandex.net:444","foo..yandex.ru","127.0.0.1"):
            self.assertFalse(module.valid_host(host))

    def test_server_error_preserves_longest_pause_and_redacts(self):
        report=module.safe_server_error({"http_code":503,"grpc_code":14,"message":"PRIVATE",
            "details":{"ynison-error-code":"500140000","ynison-go-away-for-seconds":"3600"},
            "extra_headers":{"ynison-go-away-for-seconds":"90000","token":"PRIVATE"}})
        self.assertEqual(report,{"status":"error","stage":"server","http_code":503,"grpc_code":14,"error_code":500140000,"retry_after_seconds":90000})
        self.assertEqual(module.safe_server_error({"details":{"ynison-go-away-for-seconds":"bad"}})["status"],"unknown")
    def test_transport_retry_after_is_preserved_from_cause(self):
        from types import SimpleNamespace
        root=ValueError("PRIVATE")
        root.response=SimpleNamespace(status_code=503,headers={"retry-after":"7200"})
        outer=RuntimeError("PRIVATE")
        outer.__cause__=root
        self.assertEqual(module.safe_exception(outer),{"status":"unknown","stage":"client","http_code":503,"retry_after_seconds":7200})
