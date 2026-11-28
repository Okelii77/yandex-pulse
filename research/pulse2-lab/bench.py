import sys,time,json,ssl,asyncio,urllib.request,urllib.error,concurrent.futures as cf,socket
from pathlib import Path
mode,base,delay,size,fault,keep,rounds=sys.argv[1:]
delay,size,fault,keep,rounds=map(int,(delay,size,fault,keep,rounds))
assert base in ('http://127.0.0.1:18762','https://127.0.0.1:18763')
def url(i):return f'{base}/?delay={delay}&size={size}&fault={fault}&id={i}'
def classify(code,body):
 if code!=200:return str(code)
 try:
  data=json.loads(body)
  return 'ok' if data['ok'] is True and len(data['data'])==size else 'invalid'
 except (ValueError,KeyError,TypeError):return 'invalid'
def rss():
 return {k.rstrip(':'):int(v.split()[0]) for k,v in (x.split(':',1) for x in Path('/proc/self/status').read_text().splitlines() if x.startswith(('VmHWM:','VmRSS:')))}
def verify(out):
 expected=['ok']*25
 if fault:expected[:4]=['503','429','timeout','invalid']
 assert out==expected,(out,expected)
samples=[];start=time.perf_counter()
if mode=='aio':
 import aiohttp
 async def main():
  ctx=ssl.create_default_context(cafile='ca.pem') if base.startswith('https') else True
  async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=8,limit_per_host=8,force_close=not keep,ssl=ctx),timeout=aiohttp.ClientTimeout(total=1),trust_env=False,auto_decompress=False) as session:
   async def call(i):
    try:
     async with session.get(url(i),allow_redirects=False) as r:return classify(r.status,await r.read())
    except asyncio.TimeoutError:return 'timeout'
    except aiohttp.ClientError:return 'network'
   for _ in range(rounds):
    t=time.perf_counter();out=[]
    for j in range(0,25,8):out.extend(await asyncio.gather(*(call(i) for i in range(j,min(j+8,25)))))
    verify(out);samples.append((time.perf_counter()-t)*1000)
 asyncio.run(main())
else:
 assert not keep
 # Lazy mode deliberately reproduces concurrent opener initialization; ready mode builds once.
 if mode=='ready' or base.startswith('https'):
  ctx=ssl.create_default_context(cafile='ca.pem') if base.startswith('https') else ssl.create_default_context()
  urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=ctx)))
 def call(i):
  try:
   with urllib.request.urlopen(url(i),timeout=1) as r:return classify(r.status,r.read())
  except urllib.error.HTTPError as e:return classify(e.code,e.read())
  except (TimeoutError,socket.timeout):return 'timeout'
  except urllib.error.URLError as e:return 'timeout' if isinstance(e.reason,TimeoutError) else 'network'
 with cf.ThreadPoolExecutor(max_workers=8) as pool:
  for _ in range(rounds):
   t=time.perf_counter();out=[]
   for j in range(0,25,8):out.extend(pool.map(call,range(j,min(j+8,25))))
   verify(out);samples.append((time.perf_counter()-t)*1000)
print(json.dumps(dict(samples=samples,elapsed_ms=(time.perf_counter()-start)*1000,**rss())))
