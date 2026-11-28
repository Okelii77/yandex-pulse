"""Loopback WebSocket integration, no external endpoints."""
import base64, hashlib, json, pathlib, socket, struct, subprocess, threading
root=pathlib.Path(__file__).resolve().parent
fixtures=json.loads((root/'../../monitor/ynison_alt/state-fixtures.json').read_text())
def exchange(frames):
 with socket.socket() as server:
  server.bind(('127.0.0.1',0));server.listen(1);server.settimeout(5)
  port=server.getsockname()[1];issues=[]
  def serve():
   try:
    with server.accept()[0] as c:
     c.settimeout(3);f=c.makefile('rb')
     request=f.readline()
     assert request.startswith(b'GET /state ')
     headers={}
     while True:
      line=f.readline()
      if line==b'\r\n':break
      if not line:raise RuntimeError('EOF')
      k,v=line.split(b':',1);headers[k.lower()]=v.strip()
     key=base64.b64encode(hashlib.sha1(headers[b'sec-websocket-key']+b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
     c.sendall(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+key+b'\r\n\r\n')
     h=f.read(2);assert len(h)==2 and h[1]&128
     n=h[1]&127
     if n==126:n=struct.unpack('!H',f.read(2))[0]
     elif n==127:n=struct.unpack('!Q',f.read(8))[0]
     assert n<65536
     mask=f.read(4);data=f.read(n);hello=json.loads(bytes(b^mask[i%4] for i,b in enumerate(data)))
     assert hello['rid']=='synthetic'
     for frame in frames:
      data=json.dumps(frame).encode();n=len(data);prefix=bytes([129,n]) if n<126 else bytes([129,126])+struct.pack('!H',n)
      c.sendall(prefix+data)
     try:c.sendall(b'\x88\x00')
     except BrokenPipeError:pass
   except Exception as exc:issues.append(type(exc).__name__)
  th=threading.Thread(target=serve);th.start()
  result=subprocess.run([str(root/'target/release/pulse-ynison'),str(port)],capture_output=True,text=True,timeout=10,check=True)
  th.join(6);assert not th.is_alive() and not issues,issues
  return json.loads(result.stdout)
cases=[('state',[{},fixtures[6]['frame']],{'status':'ok'}),('idle',[fixtures[4]['frame']],{'status':'no_data'}),('service_only',[{}, {'devices':[]}],{'status':'unknown'}),('go_away',[{'error':{'http_code':503,'grpc_code':14,'details':{'ynison-error-code':'500140000','ynison-go-away-for-seconds':'3600'}}}],{'status':'error','retry_after_seconds':3600})]
out=[]
for name,frames,expected in cases:
 got=exchange(frames);out.append(dict(name=name,expected=expected,actual=got,ok=got==expected))
(root/'ynison-ws-results.json').write_text(json.dumps(out,indent=2));print(out);assert all(x['ok'] for x in out)
