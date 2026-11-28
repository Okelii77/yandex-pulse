from store import Store,SLOT,DAY,etag
from concurrent.futures import ThreadPoolExecutor
import tempfile,pathlib,json
with tempfile.TemporaryDirectory() as d:
 s=Store(pathlib.Path(d)/'lab.db');t=1795852800;t=t//SLOT*SLOT
 data={'checks':[{'id':'a'},{'id':'b'}],'results':[{'id':'a','status':'ok','latency_ms':10},{'id':'b','status':'down','latency_ms':50}]}
 with ThreadPoolExecutor(max_workers=16) as p:r=list(p.map(lambda _:s.acquire(t),range(32)))
 assert len([x for x in r if x])==1;slot,token=next(x for x in r if x)
 assert not s.publish(slot,'wrong',t,data);assert not s.publish(slot,token,t,data,fail=True);assert s.current() is None
 assert s.publish(slot,token,t,data);assert not s.publish(slot,token,t,data);assert not s.acquire(t)
 code,tag,body=s.history(t);assert code==200 and etag(body)==tag;assert s.history(t,known=tag)==(304,tag,None)
 old=json.loads(body);slot2,token2=s.acquire(t+SLOT);assert not s.publish(slot2,token2,t+SLOT+301,data);slot2,replacement=s.acquire(t+SLOT+301);assert replacement!=token2;assert not s.publish(slot2,token2,t+SLOT+301,data);assert s.publish(slot2,replacement,t+SLOT+301,data)
 now=t+SLOT+301;code,tag,body=s.history(now);code2,tag2,delta=s.history(now,since=1);v=json.loads(delta);series=old['series'];series.update(v['replace']);[series.pop(k,None) for k in v['remove']];assert series==json.loads(body)['series'] and v['full_etag']==tag and etag(delta)==tag2 and tag2!=tag
 assert s.history(now+30)[2]==body
 m=Store(pathlib.Path(d)/'maintenance.db');a,b=m.acquire(t);assert m.publish(a,b,t,data);before=m.current();assert m.history(t+31*DAY)[0]==200 and not json.loads(m.history(t+31*DAY)[2])['series'];after=m.current();assert after[1]==before[1] and after[3]==before[3] and after[0]>before[0]
 for i in range(2,48*31):
  when=t+i*SLOT;slot,token=s.acquire(when);assert s.publish(slot,token,when,data)
 with s.connect() as db:
  rows,min_t=db.execute('SELECT COUNT(*),min(t) FROM samples').fetchone();assert min_t>=when-30*DAY
 assert not s.acquire(t);assert s.history(when,known=s.current()[5])[0]==304
 result={'virtual_slots':48*31,'concurrent_acquire_attempts':32,'successful_leases_first_slot':1,'samples_after_retention':rows,'latest_revision':s.current()[0],'tests':'passed'}
 pathlib.Path('store-results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
