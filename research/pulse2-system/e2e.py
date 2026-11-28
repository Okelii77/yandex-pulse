"""Real native subprocess -> loopback mock APIs/TLS -> transactional SQLite -> HTTP API.
Optional real Chrome reads the actual dashboard from the local fixture. No live Yandex.
"""
from store import Store,SLOT,encode,etag
import datetime as dt,http.server as h,ssl,threading,subprocess as sp, tempfile,pathlib,json,time,urllib.request,urllib.error,shutil,re,os,statistics
root=pathlib.Path(__file__).resolve().parent
catalog=json.loads((root/'../../monitor/services.json').read_text());ids={x['id']:x for x in catalog['checks']}
fields={'disk-api':'total_space','wiki-api':'id','cloud-iam':'serviceAccounts','cloud-monitoring':'metrics','ai-models':'data','music-rest':'account','music-history':'items','music-queues':'items'}
disabled={'music-ynison','maps-geocoder','ai-speech','ai-vision'}
expected={x:'ok' for x in ids};expected.update({x:'disabled' for x in disabled});expected.update({'music-history':'no_data','cloud-storage':'degraded','wiki-api':'no_data','cloud-monitoring':'degraded','other-weather':'down'})
class Server(h.ThreadingHTTPServer):request_queue_size=128;daemon_threads=True
def iso(t):return dt.datetime.fromtimestamp(t,dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
reports=[]
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d)
 def openssl(*a):sp.run(['openssl',*a],check=True,capture_output=True)
 openssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(p/'ca.key'),'-out',str(p/'ca.pem'),'-days','1','-subj','/CN=Lab CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign')
 openssl('req','-new','-newkey','rsa:2048','-nodes','-keyout',str(p/'key'),'-out',str(p/'csr'),'-subj','/CN=127.0.0.1')
 (p/'ext').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n')
 openssl('x509','-req','-in',str(p/'csr'),'-CA',str(p/'ca.pem'),'-CAkey',str(p/'ca.key'),'-CAcreateserial','-out',str(p/'cert'),'-days','1','-extfile',str(p/'ext'))
 for lang,cmd in [('go',[str(root/'core-go')]),('rust',[str(root/'target/release/pulse2-native')])]:
  s=Store(p/(lang+'.db'));now=int(time.time());slot=now//SLOT*SLOT;now=slot+1;counts={};mu=threading.Lock();published=[]
  class Handler(h.BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def reply(self,code,body='',content='application/json',tag=None):
    if not isinstance(body,bytes):body=body.encode()
    self.send_response(code);self.send_header('Content-Type',content);self.send_header('Content-Length',str(len(body)))
    if tag:self.send_header('ETag',tag)
    self.end_headers()
    try:self.wfile.write(body)
    except OSError:pass
   def do_GET(self):
    path=self.path.split('?')[0]
    if path.startswith('/mock/'):
     name=path.split('/')[-1];assert name in ids and name not in disabled
     with mu:counts[name]=counts.get(name,0)+1
     time.sleep(.03)
     if name=='cloud-storage':return self.reply(403,'{}')
     if name=='other-weather':return self.reply(503,'{}')
     if name in fields:
      assert self.headers.get('Authorization')=='OAuth synthetic-fixture'
      if name=='wiki-api':return self.reply(404,'{}')
      if name=='cloud-monitoring':return self.reply(429,'{}')
      val=[] if name=='music-history' else [1] if name=='music-queues' else 1
      return self.reply(200,encode({fields[name]:val}))
     return self.reply(200,'{}')
    row=s.current()
    if path in ('/api/status','/status.json'):
     if not row:return self.reply(503,'{}')
     return self.reply(200,row[3],tag=etag(row[3]))
    if path in ('/api/history','/history.json'):
     code,tag,body=s.history(now,self.headers.get('If-None-Match'))
     if path=='/history.json' and body:
      v=json.loads(body);v['series']={k:[[iso(t),st,ms] for t,st,ms in a] for k,a in v['series'].items()};body=encode(v)
     return self.reply(code,body or '',tag=tag if path=='/api/history' else None)
    if path=='/api-config.js':return self.reply(200,'window.PULSE_API_CONFIG={};','text/javascript')
    static='index.html' if path=='/' else path[1:]
    if not re.fullmatch(r'[a-zA-Z0-9_.-]+',static):return self.reply(404)
    f=root/'../../site'/static
    if not f.is_file():return self.reply(404)
    return self.reply(200,f.read_bytes(),{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.mjs':'text/javascript'}.get(f.suffix,'application/octet-stream'))
   def do_POST(self):
    if self.path!='/api/ingest':return self.reply(404)
    n=int(self.headers.get('Content-Length','0'))
    if not 0<n<=100000:return self.reply(413)
    try:
     a=json.loads(self.rfile.read(n));v=a['payload'];assert v['generated_at']==iso(now) and set(x['id'] for x in v['checks'])==set(ids)
     if not s.publish(a['slot'],a['lease'],now,v):return self.reply(409)
     published.append(time.perf_counter());return self.reply(200,'{"ok":true}')
    except (ValueError,AssertionError,KeyError):return self.reply(422)
  http=Server(('127.0.0.1',0),Handler);tls=Server(('127.0.0.1',0),Handler);ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(p/'cert',p/'key');tls.socket=ctx.wrap_socket(tls.socket,server_side=True)
  for srv in (http,tls):threading.Thread(target=srv.serve_forever,daemon=True).start()
  base=f'http://127.0.0.1:{http.server_port}';cycles=[]
  try:
   for i in range(5):
    now=slot+1+i*SLOT;start=time.perf_counter();lease=s.acquire(now);assert lease and s.acquire(now) is None
    f=p/'spec.json';f.write_text(encode(dict(base=base,tls_addr=f'127.0.0.1:{tls.server_port}',ca=(p/'ca.pem').read_text(),slot=lease[0],lease=lease[1],generated_at=iso(now),catalog=catalog)))
    native=json.loads(sp.check_output(cmd+[str(f)],timeout=30));status=json.load(urllib.request.urlopen(base+'/api/status'));got={x['id']:x['status'] for x in status['results']}
    assert got==expected,(lang,{k:(expected[k],got.get(k)) for k in expected if expected[k]!=got.get(k)})
    with urllib.request.urlopen(base+'/api/history') as r:tag=r.headers['ETag'];history=json.load(r)
    try:urllib.request.urlopen(urllib.request.Request(base+'/api/history',headers={'If-None-Match':tag}));raise AssertionError('expected 304')
    except urllib.error.HTTPError as e:assert e.code==304
    cycles.append(dict(**native,scheduler_to_commit_ms=(published[-1]-start)*1000,scheduler_to_api_ms=(time.perf_counter()-start)*1000,revision=history['revision']))
   assert not set(disabled)&set(counts);assert counts['other-weather']==10
   chrome=shutil.which('google-chrome') or shutil.which('chromium')
   browser=None
   if chrome:
    start=time.perf_counter()
    dom=sp.run([chrome,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-gpu','--no-first-run','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--user-data-dir='+str(p/(lang+'-chrome')),'--virtual-time-budget=3000','--dump-dom',base+'/#/'],capture_output=True,text=True,timeout=40,check=True).stdout
    # Actual frontend must render all service cards, not merely load HTML.
    n=len(re.findall(r'class="service-card(?:\s|")',dom));assert n==len(ids),(lang,n)
    browser={'cards':n,'cold_chrome_to_rendered_dom_ms':(time.perf_counter()-start)*1000}
   reports.append(dict(language=lang,checks=len(ids),cycles=cycles,disabled_no_network=sorted(disabled),retry_count=counts['other-weather'],browser=browser))
  finally:
   for srv in (http,tls):srv.shutdown();srv.server_close()
pathlib.Path('e2e-results.json').write_text(json.dumps(reports,indent=2));print(json.dumps(reports))
