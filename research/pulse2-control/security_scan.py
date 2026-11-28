"""Read-only audit of resolved Cargo, npm, Python dependencies against OSV.
No secrets and no Yandex calls; scan failure is a failed release gate.
"""
import json, pathlib, urllib.request, tomllib, sys, subprocess
root=pathlib.Path(__file__).resolve().parent
queries=[]
for p in tomllib.loads((root/'../pulse2-rc/Cargo.lock').read_text())['package']:
 if p.get('source','').startswith('registry+'):queries.append(dict(package=dict(ecosystem='crates.io',name=p['name']),version=p['version']))
for path in [root/'package-lock.json']:
 for key,p in json.loads(path.read_text())['packages'].items():
  if key and p.get('version') and not p.get('link'):queries.append(dict(package=dict(ecosystem='npm',name=key.rsplit('node_modules/',1)[-1]),version=p['version']))
for line in (root/'python-resolved.txt').read_text().splitlines():
 if '==' in line:
  name,version=line.split('==',1);queries.append(dict(package=dict(ecosystem='PyPI',name=name),version=version))
out=[]
for i in range(0,len(queries),100):
 batch=queries[i:i+100];req=urllib.request.Request('https://api.osv.dev/v1/querybatch',data=json.dumps({'queries':batch}).encode(),headers={'Content-Type':'application/json'},method='POST')
 with urllib.request.urlopen(req,timeout=30) as r:answers=json.load(r)['results']
 if len(answers)!=len(batch):raise RuntimeError('incomplete OSV response')
 for q,a in zip(batch,answers):
  if a.get('vulns'):out.append({'package':q,'advisories':a['vulns']})
report={'scanned':len(queries),'findings':out,'coverage':'Cargo registry lock, npm lock and Python resolved dependencies; not source-code or Go stdlib audit'}
(root/'security-results.json').write_text(json.dumps(report,indent=2));print('RC2_OSV',json.dumps(report));sys.exit(bool(out))
