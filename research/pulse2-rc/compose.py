"""Merge only the native public stage with unchanged production adapter semantics.
Fixture mode uses injected fixture rows; never invokes Yandex. No publishing.
"""
import json,pathlib,sys,datetime as dt
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from monitor.check import optional_music_probe
from monitor.auth_checks import perform
def compose(catalog,native,adapter):
 checks=catalog['checks'];ids={c['id'] for c in checks};public={c['id'] for c in checks if c['kind'] in ('http','http_gateway','tcp_tls')}
 rows=native['results'];assert len(rows)==len(public) and {r['id'] for r in rows}==public
 rest=adapter['results'];assert len(rest)==len(ids-public) and {r['id'] for r in rest}==ids-public
 allrows={r['id']:r for r in rows+rest}
 return dict(schema=1,generated_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z'),interval_minutes=30,scope='Synthetic probes; NOT official Yandex status.',categories=catalog['categories'],checks=checks,results=[allrows[c['id']] for c in checks])
def legacy_adapters(catalog,previous,approved=False):
 if not approved:raise RuntimeError('real adapters not approved')
 import os
 assert os.environ.get('PULSE_RC_APPROVED_ADAPTERS')=='1'
 # Paid calls and scheduled Ynison never allowed in RC.
 os.environ['PULSE_ENABLE_BILLABLE_PROBES']='0';os.environ['PULSE_YNISON_AUTOPROBE']='0'
 old={r['id']:r for r in previous.get('results',[])};rows=[]
 for c in catalog['checks']:
  if c['kind'] in ('http','http_gateway','tcp_tls'):continue
  if c['kind']=='requires_key':rows.append(perform(c,old.get(c['id'],{})))
  else:rows.append(optional_music_probe(c,os.environ.get('YANDEX_MUSIC_TOKEN','').strip(),old.get(c['id'],{})))
 return {'results':rows}
if __name__=='__main__':
 if len(sys.argv)!=4:raise SystemExit('usage: compose.py catalog.json native.json adapter-fixtures.json')
 print(json.dumps(compose(*(json.loads(pathlib.Path(x).read_text()) for x in sys.argv[1:])),ensure_ascii=False))
