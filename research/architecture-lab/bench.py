import concurrent.futures as cf, urllib.request, sys, time, json, resource
mode=sys.argv[1]; delay=int(sys.argv[2]); url=f'http://127.0.0.1:18761/?delay={delay}'
def call(_=None):
    with urllib.request.urlopen(url, timeout=9) as r:
        assert r.status == 200 and json.load(r)['ok'] is True
    return 1
t=time.perf_counter()
with cf.ThreadPoolExecutor(max_workers=8) as pool:
    if mode=='baseline':
        public=sum(pool.map(call,range(22)))
        rest=call(); history=call()+call(); queue=call()+call()
    else:
        public_f=[pool.submit(call) for _ in range(22)]
        init=pool.submit(call); rest=init.result()
        follow=[pool.submit(call) for _ in range(2)]
        public=sum(x.result() for x in public_f); history,queue=[x.result() for x in follow]
assert public==22 and rest==1 and history>=1 and queue>=1
r=resource.getrusage(resource.RUSAGE_SELF)
print(json.dumps(dict(ms=(time.perf_counter()-t)*1000,cpu_ms=(r.ru_utime+r.ru_stime)*1000,rss_kib=r.ru_maxrss,requests=public+rest+history+queue)))
