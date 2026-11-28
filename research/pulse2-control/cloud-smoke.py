"""One bounded real-cloud smoke, only RC2; no Yandex or production calls."""
import json, urllib.request, urllib.error, time
BASE="https://yandex-pulse-rc2.oleg-pulse-03.workers.dev"
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(NoRedirect)
def request(path, expected, method="GET", headers=None):
    t=time.monotonic()
    req=urllib.request.Request(BASE+path, method=method, data=b"{}" if method=="POST" else None, headers=headers or {})
    try:
        response=opener.open(req,timeout=10)
    except urllib.error.HTTPError as e:
        response=e
    with response as response:
        body=response.read()
        status=response.code
        tag=response.headers.get("ETag")
    assert status==expected,(path,status,expected)
    print(json.dumps({"path":path,"status":status,"bytes":len(body),"elapsed_ms":round((time.monotonic()-t)*1000)}))
    return body,tag
health=json.loads(request("/api/health",200)[0])
assert health["environment"]=="staging" and health["mode"]=="synthetic" and health["version"]=="2.0.0-rc.2"
assert health["trigger_ready"] is False and health["lease"] is None
body,tag=request("/api/status",200)
status=json.loads(body)
assert status["environment"]=="staging" and status["data_mode"]=="synthetic"
assert len(status["results"])==34 and sum(x["status"]=="disabled" for x in status["results"])==4
assert all("SYNTHETIC ADMIN SEED" in x["reason"] for x in status["results"])
assert tag and request("/api/status",304,headers={"If-None-Match":tag})[0]==b""
body,tag=request("/api/history",200)
history=json.loads(body)
assert len(history["series"])==30 and tag
assert request("/api/history",304,headers={"If-None-Match":tag})[0]==b""
assert b"STAGING" in request("/",200)[0]
assert b"PulseLive" in request("/live-api.js",200)[0]
assert b"yandex-pulse-rc2.oleg-pulse-03.workers.dev" in request("/api-config.js",200)[0]
assert json.loads(request("/api/ynison/status",200)[0])["available"] is False
request("/api/ynison/acquire",403,method="POST")
request("/api/rc/acquire",401,method="POST")
request("/api/trigger",403,method="POST")
print("RC2_CLOUD_SMOKE_OK: administrative fixture; not OIDC runner publication, not live service parity")
