import http.server as h,threading,json,subprocess as sp,pathlib
root=pathlib.Path(__file__).resolve().parent
cases=[
 ('valid',{'/account/status':(200,{'result':{'account':{'uid':123}}}),'/music-history?fullModelsCount=1':(200,{'result':{'historyTabs':[{'id':'synthetic'}]}}),'/queues':(200,{'result':{'queues':[{'id':'synthetic','modified':'2026-11-28T00:00:00Z'}]}})},['ok','ok','ok']),
 ('empty',{'/account/status':(200,{'result':{'account':{'uid':123}}}),'/music-history?fullModelsCount=1':(200,{'result':{'historyTabs':[]}}),'/queues':(200,{'result':{'queues':[]}})},['ok','no_data','no_data']),
 ('malformed',{'/account/status':(200,{'result':{}}),'/music-history?fullModelsCount=1':(200,{'result':{'items':[]}}),'/queues':(200,{'result':{'queues':[{}]}})},['degraded','degraded','degraded']),
 ('auth_and_limit',{'/account/status':(401,{}),'/music-history?fullModelsCount=1':(429,{}),'/queues':(503,{})},['down','degraded','down']),
 ('redirect',{'/account/status':(302,{}),'/music-history?fullModelsCount=1':(200,{'error':{'name':'synthetic'}}),'/queues':(200,{'result':None})},['down','degraded','no_data'])
]
out=[]
for name,fixture,expected in cases:
 calls=[]
 class H(h.BaseHTTPRequestHandler):
  def log_message(self,*a):pass
  def do_GET(self):
   assert self.headers.get('Authorization')=='OAuth synthetic-fixture'
   if self.path=='/queues':assert 'device_id=fixture' in self.headers.get('X-Yandex-Music-Device','')
   calls.append(self.path);code,body=fixture[self.path];self.send_response(code)
   if code==302:self.send_header('Location','https://example.invalid/')
   self.end_headers();self.wfile.write(json.dumps(body).encode())
 s=h.ThreadingHTTPServer(('127.0.0.1',0),H);threading.Thread(target=s.serve_forever,daemon=True).start()
 try:
  data=json.loads(sp.check_output([str(root/'target/release/music-contract'),f'http://127.0.0.1:{s.server_port}'],timeout=10))
  assert list(data[k] for k in ['music-rest','music-history','music-queues'])==expected,(name,data)
  assert calls==list(fixture)
  out.append(dict(case=name,results=data))
 finally:s.shutdown();s.server_close()
pathlib.Path('music-contract-results.json').write_text(json.dumps(out,indent=2));print('RC_MUSIC',json.dumps(out))
