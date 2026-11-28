"""Staging runner. Not executed in research CI. Explicit approvals + distinct endpoint required.
No real Ynison or paid probes. Never logs tokens, URL or account response bodies.
"""
import json,os,pathlib,subprocess,sys,urllib.request,urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'research/pulse2-rc'))
from compose import compose,legacy_adapters
import datetime as dt,time
def main():
 if os.environ.get('PULSE_RC_STAGE_APPROVED')!='1':raise RuntimeError('staging not approved')
 base=os.environ['PULSE_RC_API_URL'].rstrip('/')
 from urllib.parse import urlsplit
 u=urlsplit(base)
 if u.scheme!='https' or not u.hostname or u.username or u.password or u.path or u.query or u.fragment or not u.hostname.startswith('yandex-pulse-rc2.') or not u.hostname.endswith('.workers.dev'):raise RuntimeError('separate RC endpoint required')
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 opener=urllib.request.build_opener(NoRedirect)
 opener.addheaders=[('User-Agent','YandexPulse-Core/2.0')]
 oidc=os.environ['ACTIONS_ID_TOKEN_REQUEST_URL'];sep='&' if '?' in oidc else '?'
 req=urllib.request.Request(oidc+sep+'audience=yandex-pulse-rc-ingest',headers={'Authorization':'Bearer '+os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
 with opener.open(req,timeout=15) as r:token=json.load(r)['value']
 def call(path,body=None,auth=False):
  q=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),method='GET' if body is None else 'POST',headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if auth else {})})
  with opener.open(q,timeout=20) as r:return json.load(r)
 mode='real' if os.environ.get('PULSE_RC_REAL_APPROVED')=='1' else 'synthetic'
 if call('/api/health').get('mode')!=mode:raise RuntimeError('staging mode mismatch')
 slot,lease=os.environ.get('PULSE_RC_SLOT',''),os.environ.get('PULSE_RC_LEASE','')
 if bool(slot)!=bool(lease):raise RuntimeError('invalid dispatch claim')
 try:
  claim={'slot':int(slot),'token':lease} if slot else call('/api/rc/acquire',{},True)
  if call('/api/rc/start',{'claim':claim},True).get('ok') is not True:raise RuntimeError('lease not owned')
 except urllib.error.HTTPError as e:
  if e.code==409:print('RC skip: slot reserved, consumed or expired');return
  raise
 # Native public probe occurs only after a successful atomic start.
 catalog_path=ROOT/'monitor/services.json';catalog=json.loads(catalog_path.read_text())
 try:previous=call('/api/status')
 except urllib.error.HTTPError as e:
  if e.code!=503:raise
  previous={}
 began=time.monotonic()
 if os.environ.get('PULSE_RC_REAL_APPROVED')=='1':
  # Only separately named staging credentials are mapped by protected workflow.
  native=json.loads(subprocess.check_output([str(ROOT/'research/pulse2-rc/target/release/pulse-core-rc'),'public',str(catalog_path)],timeout=150,env={'PULSE_RC_APPROVED_PUBLIC':'1'}))
  rows=legacy_adapters(catalog,previous,approved=True)
  data=compose(catalog,native,rows)
 else:
  stamp=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
  data=dict(catalog,generated_at=stamp,results=[dict(id=c['id'],status='disabled' if c['kind']=='music_ynison' or c['id'] in ('maps-geocoder','ai-speech','ai-vision') else 'not_configured',checked_at=stamp,latency_ms=None,reason='staging synthetic schedule only') for c in catalog['checks']])
 data['data_mode']=mode
 print('RC core_ms',round((time.monotonic()-began)*1000))
 upload=time.monotonic()
 if call('/api/rc/ingest',{'claim':claim,'payload':data},True).get('ok') is not True:raise RuntimeError('ingest rejected')
 print('RC snapshot accepted, 34 components; upload_ms',round((time.monotonic()-upload)*1000))
if __name__=='__main__':
 try:main()
 except Exception as e:
  print('RC failed:',type(e).__name__);raise SystemExit(1)
