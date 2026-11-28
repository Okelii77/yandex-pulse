"""Read only existing synthetic rev1/rev2. No acquisitions or external API checks."""
import json, pathlib, urllib.request, urllib.error
BASE='https://yandex-pulse-rc2.oleg-pulse-03.workers.dev'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(NoRedirect)
def req(path, code=200, tag=None, method='GET', origin=None, body=None):
    h={'User-Agent':'YandexPulse-RC2-Smoke/2.0','Accept':'application/json'}
    if tag:h['If-None-Match']=tag
    if origin:h['Origin']=origin
    if body is not None:h['Content-Type']='application/json'
    try:r=opener.open(urllib.request.Request(BASE+path,headers=h,method=method,data=body),timeout=15)
    except urllib.error.HTTPError as e:r=e
    with r:
        data=r.read(); assert r.code==code,(path,r.code,code)
        etag=r.headers.get('ETag')
    if code==304:assert not data;return None,etag,0
    return json.loads(data),etag,len(data)
old=json.loads(pathlib.Path(__file__).with_name('history-rev1-fixture.json').read_text())
status,st,_=req('/api/status')
assert st=='"s-2"' and len(status['results'])==34 and status['data_mode']=='synthetic'
req('/api/status',304,st)
full,ht,size=req('/api/history')
assert full['revision'].startswith('2-') and len(full['series'])==30
assert all(len(a)==2 and len({x[0] for x in a})==2 for a in full['series'].values())
req('/api/history',304,ht)
path='/api/history?since='+old['revision']
delta,dt,ds=req(path)
assert delta['base_revision']==old['revision'] and delta['revision']==full['revision'] and delta['full_etag']==ht
merged=dict(old['series']);merged.update(delta['replace'])
for k in delta['remove']:merged.pop(k,None)
assert merged==full['series']
req(path,304,dt)
fallback,_,_=req('/api/history?since=999-1');assert fallback==full
req('/api/trigger',403,method='POST',origin='https://invalid.example',body=b'{}')
req('/api/trigger',503,method='POST',origin=BASE,body=b'{"turnstileToken":"invalid-test"}')
req('/api/ynison/acquire',403,method='POST',body=b'{}')
print('RC2_CLOUD_HISTORY',json.dumps(dict(revision=full['revision'],old_revision=old['revision'],series=30,points=60,duplicate_points=0,full_bytes=size,delta_bytes=ds,delta_304=True,unknown_base_fallback=True,origin_rejected=True,dispatch_disabled=True)))
