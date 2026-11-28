"""Local SQLite contract model; all timestamps in integer seconds. No cloud I/O."""
import sqlite3,json,hashlib,uuid
SLOT=1800;DAY=86400;KEEP=30*DAY
def encode(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def etag(x):return '"'+hashlib.sha256(x.encode()).hexdigest()+'"'
class Store:
 def __init__(self,path):
  self.path=str(path)
  with self.connect() as db:db.executescript('''PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS lease(slot INTEGER PRIMARY KEY,token TEXT NOT NULL,expires INTEGER NOT NULL,state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS samples(id TEXT NOT NULL,t INTEGER NOT NULL,status TEXT NOT NULL,ms INTEGER,PRIMARY KEY(id,t));
CREATE INDEX IF NOT EXISTS sample_t ON samples(t);
CREATE TABLE IF NOT EXISTS snapshots(rev INTEGER PRIMARY KEY,slot INTEGER NOT NULL,asof INTEGER NOT NULL,status TEXT NOT NULL,history TEXT NOT NULL,tag TEXT NOT NULL);
''')
 def connect(self):
  db=sqlite3.connect(self.path,timeout=10,isolation_level=None);db.execute('PRAGMA busy_timeout=10000');return db
 def acquire(self,now):
  slot=now//SLOT*SLOT;token=uuid.uuid4().hex
  with self.connect() as db:
   db.execute('BEGIN IMMEDIATE')
   old=db.execute('SELECT state,expires FROM lease WHERE slot=?',(slot,)).fetchone()
   latest=db.execute('SELECT max(slot) FROM snapshots').fetchone()[0]
   if latest is not None and latest>=slot or old and (old[0]=='done' or old[1]>now):db.rollback();return None
   db.execute("INSERT INTO lease VALUES(?,?,?,'running') ON CONFLICT(slot) DO UPDATE SET token=excluded.token,expires=excluded.expires,state=excluded.state",(slot,token,now+300));db.commit();return slot,token
 def aggregate(self,db,now):
  rows=db.execute('''WITH ranked AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY id,CASE WHEN t>=? THEN 'r'||(t/1800) WHEN t>=? THEN 'w'||(t/7200) ELSE 'm'||(t/21600) END ORDER BY CASE status WHEN 'down' THEN 0 WHEN 'degraded' THEN 1 ELSE 2 END,t DESC) rn FROM samples WHERE t>=? AND t<=?) SELECT id,t,status,ms FROM ranked WHERE rn=1 ORDER BY id,t''',(now-DAY,now-7*DAY,now-KEEP,now+SLOT-1)).fetchall();series={}
  for k,t,s,m in rows:series.setdefault(k,[]).append([t,s,m])
  return series
 def publish(self,slot,token,now,payload,fail=False):
  rows=payload['results'];ids=[x['id'] for x in rows];assert len(ids)==len(set(ids)) and set(ids)=={x['id'] for x in payload['checks']}
  assert slot<=now<slot+SLOT
  with self.connect() as db:
   db.execute('BEGIN IMMEDIATE');lease=db.execute('SELECT token,expires,state FROM lease WHERE slot=?',(slot,)).fetchone();latest=db.execute('SELECT rev,slot FROM snapshots ORDER BY rev DESC LIMIT 1').fetchone()
   if not lease or lease[0]!=token or lease[1]<=now or lease[2]!='running' or latest and latest[1]>=slot:db.rollback();return False
   db.executemany('INSERT INTO samples VALUES(?,?,?,?)',[(x['id'],now,x['status'],x.get('latency_ms')) for x in rows if x['status'] in ('ok','down','degraded','no_data')]);db.execute('DELETE FROM samples WHERE t<?',(slot-KEEP,));series=self.aggregate(db,slot);rev=(latest[0] if latest else 0)+1
   status=encode(payload);history=encode({'schema':1,'retention_days':30,'revision':rev,'as_of':slot,'series':series});tag=etag(history)
   db.execute('INSERT INTO snapshots VALUES(?,?,?,?,?,?)',(rev,slot,slot,status,history,tag));db.execute('DELETE FROM snapshots WHERE rev<?',(rev-4,));db.execute("UPDATE lease SET state='done' WHERE slot=? AND token=?",(slot,token));db.execute('DELETE FROM lease WHERE slot<?',(slot-KEEP,))
   if fail:db.rollback();return False
   db.commit();return True
 def current(self):
  with self.connect() as db:return db.execute('SELECT rev,slot,asof,status,history,tag FROM snapshots ORDER BY rev DESC LIMIT 1').fetchone()
 def refresh(self,now):
  bucket=now//SLOT*SLOT
  with self.connect() as db:
   db.execute('BEGIN IMMEDIATE');old=db.execute('SELECT rev,slot,asof,status FROM snapshots ORDER BY rev DESC LIMIT 1').fetchone()
   if not old or old[2]>=bucket:db.rollback();return False
   db.execute('DELETE FROM samples WHERE t<?',(bucket-KEEP,));rev=old[0]+1
   body=encode({'schema':1,'retention_days':30,'revision':rev,'as_of':bucket,'series':self.aggregate(db,bucket)})
   db.execute('INSERT INTO snapshots VALUES(?,?,?,?,?,?)',(rev,old[1],bucket,old[3],body,etag(body)));db.execute('DELETE FROM snapshots WHERE rev<?',(rev-4,));db.commit();return True
 def history(self,now,known=None,since=None):
  bucket=now//SLOT*SLOT;latest=self.current()
  if latest and latest[2]<bucket:self.refresh(now)
  with self.connect() as db:
   db.execute('BEGIN');row=db.execute('SELECT rev,asof,history,tag FROM snapshots ORDER BY rev DESC LIMIT 1').fetchone()
   if not row:return 503,None,None
   rev,asof,body,tag=row
   if known==tag and since is None:return 304,tag,None
   if since is not None:
    old=db.execute('SELECT history FROM snapshots WHERE rev=?',(since,)).fetchone()
    if old and since<rev:
     prev=json.loads(old[0])['series'];cur=json.loads(body)['series'];delta=encode({'schema':1,'base_revision':since,'revision':rev,'as_of':asof,'replace':{k:v for k,v in cur.items() if prev.get(k)!=v},'remove':sorted(set(prev)-set(cur)),'full_etag':tag});return (304,etag(delta),None) if known==etag(delta) else (200,etag(delta),delta)
   if known==tag:return 304,tag,None
   return 200,tag,body
