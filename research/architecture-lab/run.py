import subprocess, json, time, statistics, random, pathlib, platform
from collections import defaultdict
base=pathlib.Path(__file__).parent
server=subprocess.Popen([str(base/'mock')]);time.sleep(.2)
cmds={'Python baseline':['python','-S',str(base/'bench.py'),'baseline'],'Python optimized':['python','-S',str(base/'bench.py'),'optimized'],'Go optimized':[str(base/'bench-go')]}
rows=[];rng=random.Random(42)
try:
 for delay in [0,30,80]:
  for cmd in cmds.values():subprocess.check_output(cmd+[str(delay)])
  for i in range(6):
   order=list(cmds);rng.shuffle(order)
   for name in order:
    t=time.perf_counter();out=json.loads(subprocess.check_output(cmds[name]+[str(delay)]));out.update(mode=name,delay=delay,process_ms=(time.perf_counter()-t)*1000,iteration=i);rows.append(out)
finally:server.terminate();server.wait()
(base/'results.json').write_text(json.dumps(rows,indent=2))
for d in [0,30,80]:
 for name in cmds:
  a=[r for r in rows if r['delay']==d and r['mode']==name];v=[r['ms'] for r in a];p=statistics.quantiles(v,n=20,method='inclusive')[18]
  print(d,name,'p50',round(statistics.median(v),2),'p95',round(p,2),'cpu median',round(statistics.median(r['cpu_ms'] for r in a),2),'RSS median KiB',statistics.median(r['rss_kib'] for r in a),'process p50',round(statistics.median(r['process_ms'] for r in a),2),'requests',a[0]['requests'])
