"""Analyze real exported staging leases/dispatch evidence and Actions metadata; no network."""
import argparse,json,datetime,statistics
from pathlib import Path
SLOT=1800000
def main():
    ap=argparse.ArgumentParser();ap.add_argument('export',type=Path);a=ap.parse_args();d=json.loads(a.export.read_text())
    start,end=d['start_ms'],d['end_ms'];assert start%SLOT==0 and end-start==336*SLOT
    leases=d['leases'];slots=set(range(start,end,SLOT));ls=[r for r in leases if r['slot'] in slots]
    assert len({r['slot'] for r in ls})==len(ls),'duplicate slot records'
    finished={r['slot']:r for r in ls if r['state']=='done' and r.get('finished_at') is not None}
    ontime={k for k,v in finished.items() if k<=v['finished_at']<k+SLOT}
    delays=[(v['finished_at']-k)/1000 for k,v in finished.items()]
    def p95(a):return sorted(a)[max(0,(95*len(a)+99)//100-1)] if a else None
    out=dict(expected=336,completed=len(finished),on_time=len(ontime),missing=sorted(slots-set(finished)),late=sorted(set(finished)-ontime),timely_percent=100*len(ontime)/336,duplicate_slots=0,publication_p50_s=statistics.median(delays) if delays else None,publication_p95_s=p95(delays),threshold_met=len(ontime)>=333)
    print(json.dumps(out,indent=2))
if __name__=='__main__':main()
