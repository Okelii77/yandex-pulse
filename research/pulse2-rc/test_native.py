import pathlib,subprocess as sp,json,ssl,http.server as h,threading,tempfile,os,time,statistics
from compose import compose
root=pathlib.Path(__file__).resolve().parent;catalog=json.loads((root/'../../monitor/services.json').read_text())
class Server(h.ThreadingHTTPServer):request_queue_size=128;daemon_threads=True
class Handler(h.BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path=='/redirect':self.send_response(302);self.send_header('Location','/200');self.end_headers();return
  if self.path=='/bad-redirect':self.send_response(302);self.send_header('Location','https://example.invalid/');self.end_headers();return
  time.sleep(.03);self.send_response(int(self.path[1:]));self.end_headers()
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d)
 def openssl(*a):sp.run(['openssl',*a],check=True,capture_output=True)
 openssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(p/'ca.key'),'-out',str(p/'ca.pem'),'-days','1','-subj','/CN=RC test CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign')
 openssl('req','-new','-newkey','rsa:2048','-nodes','-keyout',str(p/'key'),'-out',str(p/'csr'),'-subj','/CN=127.0.0.1')
 (p/'ext').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n')
 openssl('x509','-req','-in',str(p/'csr'),'-CA',str(p/'ca.pem'),'-CAkey',str(p/'ca.key'),'-CAcreateserial','-out',str(p/'cert'),'-days','1','-extfile',str(p/'ext'))
 a,b=[Server(('127.0.0.1',0),Handler) for _ in range(2)];ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(p/'cert',p/'key');b.socket=ctx.wrap_socket(b.socket,server_side=True)
 for s in (a,b):threading.Thread(target=s.serve_forever,daemon=True).start()
 fixture=json.loads(json.dumps(catalog));expected={};adapters=[]
 for c in fixture['checks']:
  if c['kind']=='tcp_tls':c.update(host='127.0.0.1',port=b.server_port);expected[c['id']]='ok'
  elif c['kind'] in ('http','http_gateway'):
   code=403 if c['id']=='cloud-storage' else 503 if c['id']=='other-weather' else 429 if c['id']=='search-web' else 200
   path='redirect' if c['id']=='music-web' else 'bad-redirect' if c['id']=='other-market' else str(code)
   c['url']=f'http://127.0.0.1:{a.server_port}/{path}';expected[c['id']]='down' if code==503 or path=='bad-redirect' else 'degraded' if code in (403,429) else 'ok'
  else:adapters.append(dict(id=c['id'],status='disabled' if c['id'] in ('music-ynison','maps-geocoder','ai-speech','ai-vision') else 'not_configured',checked_at='2026-11-28T00:00:00Z',latency_ms=None))
 f=p/'catalog.json';f.write_text(json.dumps(fixture));env=dict(os.environ,PULSE_FIXTURE_CA=str(p/'ca.pem'))
 data={};payload=None
 for name,cmd in [('rust','target/release/pulse-core-rc'),('go','core-go')]:
  measurements=[]
  for i in range(30):
   t=time.perf_counter();r=json.loads(sp.check_output([str(root/cmd),'fixture',str(f)],env=env,timeout=20));measurements.append((time.perf_counter()-t)*1000)
   assert {x['id']:x['status'] for x in r['results']}==expected
   payload=compose(catalog,r,{'results':adapters});assert len(payload['results'])==34
  data[name]={'cycles':len(measurements),'public_checks':len(expected),'samples_ms':measurements,'p50_ms':statistics.median(measurements),'p95_ms':sorted(measurements)[28]}
 for s in (a,b):s.shutdown();s.server_close()
 pathlib.Path('native-results.json').write_text(json.dumps(data,indent=2));pathlib.Path('fixture-status.json').write_text(json.dumps(payload));print('RC_NATIVE',json.dumps(data))
