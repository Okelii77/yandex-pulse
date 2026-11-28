"""Only loopback. Public HTTP/TLS parity; authenticated SDKs explicitly not replaced."""
import http.server as h, threading, ssl, subprocess as sp, tempfile, pathlib,json,time,socket
root=pathlib.Path(__file__).parent
class Server(h.ThreadingHTTPServer):
 request_queue_size=128
 daemon_threads=True
class Handler(h.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path=='/slow':time.sleep(3.0)
  if self.path=='/redirect':self.send_response(302);self.send_header('Location','/200');self.end_headers();return
  if self.path=='/unsafe':self.send_response(302);self.send_header('Location','https://example.invalid/');self.end_headers();return
  code=int(self.path[1:]) if self.path[1:].isdigit() else 200
  self.send_response(code);self.end_headers()
  try:self.wfile.write(b'{}')
  except OSError:pass
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d)
 def openssl(*args):sp.run(['openssl',*args],check=True,capture_output=True)
 openssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(p/'ca.key'),'-out',str(p/'ca.pem'),'-days','1','-subj','/CN=Pulse test CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign')
 openssl('req','-new','-newkey','rsa:2048','-nodes','-keyout',str(p/'key'),'-out',str(p/'csr'),'-subj','/CN=localhost')
 (p/'ext').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n')
 openssl('x509','-req','-in',str(p/'csr'),'-CA',str(p/'ca.pem'),'-CAkey',str(p/'ca.key'),'-CAcreateserial','-out',str(p/'cert'),'-days','1','-extfile',str(p/'ext'))
 openssl('verify','-CAfile',str(p/'ca.pem'),str(p/'cert'))
 servers=[Server(('127.0.0.1',0),Handler) for _ in range(2)];ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(p/'cert',p/'key');servers[1].socket=ctx.wrap_socket(servers[1].socket,server_side=True)
 for s in servers:threading.Thread(target=s.serve_forever,daemon=True).start()
 hp,ts=[s.server_port for s in servers]
 cases=[];expected={}
 def add(id,kind,status,**kw):cases.append(dict(id=id,kind=kind,**kw));expected[id]=status
 for code,status in [(200,'ok'),(204,'ok'),(401,'degraded'),(403,'degraded'),(404,'degraded'),(429,'degraded'),(503,'down')]:add(str(code),'http',status,url=f'http://127.0.0.1:{hp}/{code}')
 for name,status in [('redirect','ok'),('unsafe','down'),('slow','down')]:add(name,'http',status,url=f'http://127.0.0.1:{hp}/{name}')
 add('gateway','http_gateway','degraded',url=f'http://127.0.0.1:{hp}/403')
 add('https','http','ok',url=f'https://localhost:{ts}/200')
 add('tls','tcp_tls','ok',host='localhost',port=ts)
 add('bad-tls','tcp_tls','down',host='localhost',port=hp)
 add('ynison','music_ynison','disabled')
 for k in ['music_rest','music_history','music_queues','requires_key']:add(k,k,'unsupported')
 f=p/'spec.json';f.write_text(json.dumps(dict(checks=cases,ca=(p/'ca.pem').read_text())))
 reports={}
 for name,cmd in [('go','./core-go'),('rust','./target/release/pulse-core')]:
  r=json.loads(sp.check_output([cmd,str(f)],cwd=root,timeout=30))
  got={x['id']:x['status'] for x in r['results']};reports[name]={'cases':len(cases),'mismatches':{k:[v,got.get(k)] for k,v in expected.items() if got.get(k)!=v}}
 pathlib.Path('parity-results.json').write_text(json.dumps(reports,indent=2));print(reports)
 assert all(not r['mismatches'] for r in reports.values())
