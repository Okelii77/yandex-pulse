"""Offline diagnostics and claims regression tests. No external requests."""
import runpy, unittest, json, io, contextlib, base64, os, time, urllib.error
from pathlib import Path
from unittest.mock import patch
m=runpy.run_path(str(Path(__file__).with_name("run-synthetic.py")))
class Diagnostics(unittest.TestCase):
    def test_allowlist(self):
        for op in ("health","oidc","acquire","start","ingest"):
            secret="JWT-MUST-NEVER-BE-LOGGED"
            class Opener:
                def open(self,*a,**k):
                    raise urllib.error.HTTPError("https://secret.invalid/"+secret,401,secret,{"CF-Ray":"a619bc210875ebe6-SEA","Authorization":secret},io.BytesIO(json.dumps({"error":"unauthorized","token":secret,"message":secret}).encode()))
            buf=io.StringIO()
            with contextlib.redirect_stdout(buf),self.assertRaises(urllib.error.HTTPError):
                m["get_json"](Opener(),op,None)
            out=buf.getvalue()
            self.assertIn('"operation": "'+op+'"',out)
            self.assertIn('"status": 401',out)
            self.assertIn('"error": "unauthorized"',out)
            self.assertIn("a619bc210875ebe6-SEA",out)
            self.assertNotIn(secret,out)
        self.assertEqual(m["error_fields"](403,{},b"error code: 1010\n")["cloudflare_code"],1010)
        self.assertEqual(m["error_fields"](401,{},b'{"error":"JWT_SECRET"}'),{"status":401})
    def test_claims(self):
        now=int(time.time())
        c=dict(m["EXPECTED_CLAIMS"],jti="fixture-private-jti",run_id="123",run_attempt="1",iat=now,nbf=now,exp=now+300)
        enc=lambda x:base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip("=")
        def token(claims):return enc({"alg":"RS256","kid":"fixture-private-kid"})+"."+enc(claims)+".fixture-signature"
        with patch.dict(os.environ,{"GITHUB_RUN_ID":"123","GITHUB_RUN_ATTEMPT":"1"}),contextlib.redirect_stdout(io.StringIO()) as buf:
            self.assertTrue(all(m["check_claims"](token(c)).values()))
            for k in ("sub","repository_id","repository_owner_id","environment","ref","aud","workflow_ref","event_name","jti"):
                with self.assertRaises(RuntimeError):m["check_claims"](token(dict(c,**{k:"wrong"})))
        self.assertNotIn("fixture-private-jti",buf.getvalue())
        self.assertNotIn("fixture-private-kid",buf.getvalue())
if __name__=="__main__":unittest.main()
