import subprocess as sp, pathlib, time, json, random, statistics, sys, os, tempfile, argparse, math
p=argparse.ArgumentParser();p.add_argument('--repeats',type=int,default=100);p.add_argument('--rust',action='store_true');p.add_argument('--delays',nargs='+',type=int,default=[0,30]);a=p.parse_args()
base=pathlib.Path(__file__).resolve().parent;os.chdir(base)
cmds={'python-baseline':[sys.executable,'-S','bench.py','baseline'],'python-optimized':[sys.executable,'-S','bench.py','optimized'],'go':['./bench-go'],'node':['node','bench.mjs']}
if a.rust:cmds['rust']=['./target/release/pulse-bench']
server=sp.Popen(['./mock']);rows=[];rng=random.Random(42)
def one(name,d):
 with tempfile.NamedTemporaryFile() as t:
  start=time.perf_counter()
  try:r=sp.run(['/usr/bin/time','-f','%U %S %M','-o',t.name,*cmds[name],str(d)],capture_output=True,text=True,timeout=25)
  except sp.TimeoutExpired:return dict(error='timeout',wall_ms=(time.perf_counter()-start)*1000)
  wall=(time.perf_counter()-start)*1000
  if r.returncode:return dict(error='nonzero_exit',wall_ms=wall)
  t.seek(0);u,s,rss=map(float,t.read().split());data=json.loads(r.stdout)
  expected=27 if name=='python-baseline' else 25
  assert data['requests']==expected
  return dict(ms=data['ms'],requests=data['requests'],cpu_ms=(u+s)*1000,rss_kib=rss,wall_ms=wall)
try:
 time.sleep(.3)
 if server.poll() is not None:raise RuntimeError('mock failed to start')
 with open('stage2-results.jsonl','w') as out:
  for d in a.delays:
   for name in cmds:
    for _ in range(3):one(name,d)
   for i in range(a.repeats):
    order=list(cmds);rng.shuffle(order)
    for name in order:
     row=one(name,d);row.update(language=name,delay=d,iteration=i);rows.append(row);out.write(json.dumps(row)+'\n');out.flush()
    if (i+1)%20==0:print('delay',d,'completed',i+1,flush=True)
finally:server.terminate();server.wait()
summary=[]
for d in a.delays:
 for name in cmds:
  allr=[r for r in rows if r['delay']==d and r['language']==name];v=[r for r in allr if 'error' not in r];r=dict(delay=d,language=name,attempts=len(allr),errors=len(allr)-len(v))
  if v:
   for k in ['ms','cpu_ms','rss_kib','wall_ms']:
    z=sorted(x[k] for x in v);r[k]={'p50':statistics.median(z),'p95':z[math.ceil(.95*len(z))-1],'p99':z[math.ceil(.99*len(z))-1]}
   r['requests_per_second']=sum(x['requests'] for x in v)/(sum(x['ms'] for x in v)/1000)
  summary.append(r)
print(json.dumps(summary,indent=2));pathlib.Path('stage2-summary.json').write_text(json.dumps(summary,indent=2))
