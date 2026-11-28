"""Isolated SQLite model of atomic materialization; NOT D1 deployment."""
import sqlite3,json,time,pathlib,statistics
db=sqlite3.connect(':memory:');db.executescript('CREATE TABLE samples(check_id TEXT, t INTEGER, status TEXT, latency INTEGER, PRIMARY KEY(check_id,t)); CREATE TABLE snap(id INTEGER PRIMARY KEY, revision INTEGER, asof INTEGER, payload TEXT);')
now=1795852800;day=86400
db.executemany('INSERT INTO samples VALUES (?,?,?,?)',[(f'check-{i}',now-1800*j,'down' if j%19==0 else 'ok',j%1000) for i in range(34) for j in range(1440)]);db.commit()
def calculate(t):
 rows=db.execute("""WITH ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY check_id,CASE WHEN t>=? THEN 'r'||(t/1800) WHEN t>=? THEN 'w'||(t/7200) ELSE 'm'||(t/21600) END ORDER BY CASE WHEN status='down' THEN 0 WHEN status='degraded' THEN 1 ELSE 2 END,t DESC) rn FROM samples WHERE t>=? AND t<=?) SELECT check_id,t,status,latency FROM ranked WHERE rn=1 ORDER BY check_id,t""",(t-day,t-7*day,t-30*day,t)).fetchall()
 return json.dumps(rows,separators=(',',':'))
def publish(t,revision):
 with db:
  old=db.execute('SELECT revision,asof FROM snap WHERE id=1').fetchone()
  if old and (revision<old[0] or t<old[1]):return False
  db.execute('DELETE FROM samples WHERE t<?',(t-30*day,))
  payload=calculate(t)
  db.execute('INSERT INTO snap VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,asof=excluded.asof,payload=excluded.payload',(revision,t,payload))
 return True
def read(t):
 r=db.execute('SELECT asof,payload FROM snap WHERE id=1').fetchone()
 # Exact rolling semantics: snapshot reusable only for same cutoff epoch.
 return r[1] if r and r[0]==t else calculate(t)
assert publish(now,1);assert read(now)==calculate(now);assert not publish(now-1,0)
later=now+day;assert read(later)==calculate(later);assert publish(later,2);assert read(later)==calculate(later);assert db.execute('SELECT MIN(t) FROM samples').fetchone()[0]>=later-30*day
old=read(later)
try:
 with db:
  db.execute('DELETE FROM samples');db.execute('UPDATE snap SET payload=?',('bad',));raise RuntimeError()
except RuntimeError:pass
assert read(later)==old==calculate(later)
out={}
for name,fn in [('query',lambda:calculate(later)),('read',lambda:read(later)),('refresh',lambda:publish(later,2))]:
 times=[]
 for _ in range(10):
  s=time.perf_counter();fn();times.append((time.perf_counter()-s)*1000)
 out[name]={'p50_ms':statistics.median(times),'n':10}
pathlib.Path('history-stage2-results.json').write_text(json.dumps(out,indent=2));print(out)
