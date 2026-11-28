import sys,subprocess as sp,os,time,statistics,random,math,json,threading,tempfile,pathlib,urllib.request,socket,argparse
p=argparse.ArgumentParser();p.add_argument('--runner',default='local');p.add_argument('--quick',action='store_true');p.add_argument('--no-rust',action='store_true');a=p.parse_args()
root=pathlib.Path(__file__).resolve().parent;os.chdir(root);pathlib.Path('evidence').mkdir(exist_ok=True)
cmds={'py-lazy':[sys.executable,'bench.py','lazy'],'py-ready':[sys.executable,'bench.py','ready'],'py-aio':[sys.executable,'bench.py','aio'],'go':['./bench-go'],'node':['node','bench.mjs'],'rust':['./target/release/pulse2-bench']}
if a.no_rust:del cmds['rust']
# 100 fresh-process samples at 30ms on each runner; 100 warm-cycle samples at 80ms
# per language with pooling. Other scenarios are exploratory (10 repetitions).
scenarios=[('cold30',30,128,0,0,0,100,1),('cold0',0,128,0,0,0,10,1),('cold80',80,128,0,0,0,10,1),('warm80',80,128,0,1,0,1,100),('warm200',200,128,0,1,0,1,10),('warm500',500,128,0,1,0,1,10),('faults',30,128,1,1,0,1,10),('large',30,65536,0,1,0,1,10),('tls-close',30,128,0,0,1,10,1),('tls-reuse',30,128,0,1,1,1,10)]
if a.quick:scenarios=[(name,d,size,f,k,tls,min(reps,2),min(rounds,3)) for name,d,size,f,k,tls,reps,rounds in scenarios]
rng=random.Random(42);rows=[]
env={k:v for k,v in os.environ.items() if k.lower() not in ('http_proxy','https_proxy','all_proxy','no_proxy')};env['NO_PROXY']='127.0.0.1'
server=sp.Popen(['./fixture'])
def one(name,base,d,size,f,k,rounds):
 with tempfile.TemporaryFile() as out,tempfile.TemporaryFile() as err:
  t=time.perf_counter();proc=sp.Popen([*cmds[name],base,*map(str,(d,size,f,k,rounds))],stdout=out,stderr=err,env=env)
  timed=threading.Event()
  def stop():
   timed.set()
   try:proc.kill()
   except ProcessLookupError:pass
  timer=threading.Timer(max(30,rounds*5+20),stop);timer.start()
  try:
   _,status,r=os.wait4(proc.pid,0);proc.returncode=os.waitstatus_to_exitcode(status)
  finally:timer.cancel();timer.join()
  wall=(time.perf_counter()-t)*1000
  if proc.returncode or timed.is_set():
   err.seek(0);return dict(error='timeout' if timed.is_set() else 'exit',detail=err.read(1200).decode(errors='replace'),wall_ms=wall)
  out.seek(0);data=json.load(out)
  assert len(data['samples'])==rounds and data['VmHWM']>0
  return dict(**data,wall_ms=wall,cpu_ms=(r.ru_utime+r.ru_stime)*1000,wait4_rss_kib=r.ru_maxrss,rounds=rounds)
try:
 for _ in range(100):
  try:
   with socket.create_connection(('127.0.0.1',18762),timeout=.1):break
  except OSError:time.sleep(.05)
 else:raise RuntimeError('mock not ready')
 with open('evidence/raw.jsonl','w') as out:
  for name,d,size,f,k,tls,reps,rounds in scenarios:
   base='https://127.0.0.1:18763' if tls else 'http://127.0.0.1:18762'
   langs=[x for x in cmds if not(k and x in ('py-lazy','py-ready')) and not(tls and x=='py-lazy')]
   for i in range(reps):
    rng.shuffle(langs)
    for lang in langs:
     row=one(lang,base,d,size,f,k,rounds);row.update(runner=a.runner,scenario=name,language=lang,iteration=i);rows.append(row);out.write(json.dumps(row)+'\n');out.flush()
   print(name,'finished',flush=True)
finally:server.terminate();server.wait()
def stat(v):
 v=sorted(v);return {f'p{p}':v[math.ceil(p*len(v)/100)-1] if p!=50 else statistics.median(v) for p in (50,95,99)}
summary=[]
for name,*_ in scenarios:
 for lang in cmds:
  rr=[x for x in rows if x['scenario']==name and x['language']==lang]
  if not rr:continue
  ok=[x for x in rr if 'error' not in x];s=dict(scenario=name,language=lang,processes=len(rr),errors=len(rr)-len(ok))
  if ok:
   samples=[y for x in ok for y in x['samples']];s.update(cycles=len(samples),cycle_ms=stat(samples),cpu_ms_per_cycle=stat([x['cpu_ms']/x['rounds'] for x in ok]),hwm_kib=stat([x['VmHWM'] for x in ok]),rss_kib=stat([x['VmRSS'] for x in ok]),wait4_kib=stat([x['wait4_rss_kib'] for x in ok]),wall_ms=stat([x['wall_ms'] for x in ok]),requests_per_sec=len(samples)*25000/sum(samples))
  summary.append(s)
pathlib.Path('evidence/summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary));assert all(s['errors']==0 for s in summary), 'failed scenarios; see raw evidence'
