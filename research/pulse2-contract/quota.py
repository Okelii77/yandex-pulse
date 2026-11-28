"""Explicit hypothetical row accounting; NOT remote D1 metrics."""
import json
from pathlib import Path
n=34*48*30;refresh=48;rows=[]
for visitors in (10,50,100,500,1000,10000):
 # One history request per visitor per day; cold scan assumption, not cache-hit measured.
 old=visitors*n;new=refresh*n+visitors
 rows.append(dict(history_reads_per_day=visitors,old_cold_scan_estimate=old,materialized_estimate=new,reads_saved=old-new))
result=dict(assumptions={'history_rows':n,'refreshes_per_day':refresh,'raw_samples_per_day':34*48,'one_history_request_per_visitor':True,'indexes_and_snapshot_writes_excluded':True,'note':'D1 accounting depends on query plan and metadata. Existing revision cache can avoid full scans; compare cache misses, not all requests. Revisions may share materialization across users.'},rows=rows)
Path('quota-model.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
