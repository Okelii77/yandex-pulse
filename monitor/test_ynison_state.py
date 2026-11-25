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
