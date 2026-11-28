"""Offline actual legacy adapter functions, all 12 non-public catalog entries.
No live credentials; every external network entrypoint is intercepted.
"""
import os,sys,json,pathlib,types
from unittest.mock import patch
from compose import legacy_adapters,compose
from monitor import auth_checks
root=pathlib.Path(__file__).resolve().parent
catalog=json.loads((root/'../../monitor/services.json').read_text())
creds={k:'fixture-only' for k in ('YANDEX_MUSIC_TOKEN','YANDEX_DISK_TOKEN','YANDEX_WIKI_TOKEN','YANDEX_WIKI_ORG_ID','YANDEX_WIKI_TEST_SLUG','YC_FOLDER_ID','YC_IAM_TOKEN','YC_MONITORING_API_KEY','YC_AI_API_KEY','YANDEX_MAPS_API_KEY','YC_SPEECHKIT_API_KEY','YC_VISION_API_KEY')}
creds['PULSE_RC_APPROVED_ADAPTERS']='1'
calls=[]
def fake(url,headers=None,*args,**kwargs):
 assert not args and not kwargs
 calls.append(url)
 expected={'https://cloud-api.yandex.net/v1/disk':{'total_space':1},'https://api.wiki.yandex.net/v1/pages?slug=fixture-only':{'id':1},'https://iam.api.cloud.yandex.net/iam/v1/serviceAccounts?folderId=fixture-only&pageSize=1':{'serviceAccounts':[]},'https://monitoring.api.cloud.yandex.net/monitoring/v2/metrics?folderId=fixture-only':{'metrics':[]},'https://ai.api.cloud.yandex.net/v1/models':{'data':[]}}
 assert url in expected,url
 return 200,expected[url]
class Client:
 def __init__(self,token):assert token=='fixture-only'
 def init(self):return self
 def music_history(self,full_models_count):assert full_models_count==1;return {'historyTabs':[{}]}
 def queues_list(self):return []
with patch.dict(os.environ,creds,clear=True),patch.dict(sys.modules,{'yandex_music':types.SimpleNamespace(Client=Client)}),patch.object(auth_checks,'request_json',side_effect=fake):
 auth_checks.iam_token.cache_clear()
 out=legacy_adapters(catalog,{},approved=True)['results']
 status={x['id']:x['status'] for x in out}
 expected={'music-rest':'ok','music-history':'ok','music-queues':'no_data','music-ynison':'disabled','disk-api':'ok','wiki-api':'ok','cloud-iam':'ok','cloud-monitoring':'ok','ai-models':'ok','maps-geocoder':'disabled','ai-speech':'disabled','ai-vision':'disabled'}
 assert status==expected,(status,expected)
 assert len(calls)==5 and len(set(calls))==5
 assert 'fixture-only' not in json.dumps(out)
 assert os.environ['PULSE_ENABLE_BILLABLE_PROBES']=='0' and os.environ['PULSE_YNISON_AUTOPROBE']=='0'
 # Test 34-row composition with actual retained adapter semantics.
 native={'results':[dict(id=c['id'],status='ok',checked_at='2026-11-28T00:00:00Z',latency_ms=5) for c in catalog['checks'] if c['kind'] in ('http','http_gateway','tcp_tls')]}
 merged=compose(catalog,native,{'results':out});assert len(merged['results'])==34
 print('RC2 retained adapters 12/12, auth network mocks 5, paid and Ynison calls 0')
