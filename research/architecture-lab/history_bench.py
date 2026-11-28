import sqlite3,datetime as dt,time,statistics,json,random
now=dt.datetime(2026,11,28,10,0,tzinfo=dt.timezone.utc)
iso=lambda t:t.isoformat(timespec='seconds').replace('+00:00','Z')
db=sqlite3.connect(':memory:');db.executescript('CREATE TABLE samples(check_id TEXT NOT NULL,checked_at TEXT NOT NULL,status TEXT NOT NULL,latency_ms INTEGER,PRIMARY KEY(check_id,checked_at)); CREATE INDEX idx_samples_checked_at ON samples(checked_at); CREATE TABLE history_cache(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);')
r=random.Random(42);rows=[(f'check-{i:02d}',iso(now-dt.timedelta(minutes=30*j)),r.choice(['ok']*18+['down','degraded']),r.randint(20,1000)) for i in range(34) for j in range(1440)];db.executemany('INSERT INTO samples VALUES (?,?,?,?)',rows);db.commit()
sql="""WITH ranked AS ( SELECT check_id,checked_at,status,latency_ms, ROW_NUMBER() OVER (PARTITION BY check_id, CASE WHEN checked_at >= ? THEN 'r' || CAST(strftime('%s',checked_at)/1800 AS INT) WHEN checked_at >= ? THEN 'w' || CAST(strftime('%s',checked_at)/7200 AS INT) ELSE 'm' || CAST(strftime('%s',checked_at)/21600 AS INT) END ORDER BY CASE WHEN status='down' THEN 0 WHEN status='degraded' THEN 1 ELSE 2 END, checked_at DESC) AS rn FROM samples WHERE checked_at >= ? ) SELECT check_id,checked_at,status,latency_ms FROM ranked WHERE rn=1 ORDER BY check_id,checked_at"""
args=tuple(iso(now-dt.timedelta(days=d)) for d in (1,7,30))
def history():
 s={}
 for k,t,status,ms in db.execute(sql,args):s.setdefault(k,[]).append([t,status,ms])
 return json.dumps(dict(schema=1,retention_days=30,series=s),separators=(',',':'))
expected=history();db.execute('INSERT INTO history_cache VALUES (1,?)',(expected,));db.commit()
def cached():return db.execute('SELECT payload FROM history_cache WHERE id=1').fetchone()[0]
assert cached()==expected
out={}
for name,fn in [('query_and_serialize',history),('read_materialized',cached)]:
 timings=[]
 for _ in range(15):
  t=time.perf_counter();v=fn();timings.append((time.perf_counter()-t)*1000);assert v==expected
 out[name]={'p50_ms':statistics.median(timings),'p95_ms':statistics.quantiles(timings,n=20,method='inclusive')[18]}
out.update(input_rows=len(rows),output_points=sum(map(len,json.loads(expected)['series'].values())),output_bytes=len(expected.encode()),sqlite_version=sqlite3.sqlite_version,query_plan=db.execute('EXPLAIN QUERY PLAN '+sql,args).fetchall())
print(json.dumps(out,indent=2));open('history-results.json','w').write(json.dumps(out,indent=2))
