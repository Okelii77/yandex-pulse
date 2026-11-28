// Candidate frontend client; not installed into production site.
export class RevisionClient {
 constructor(fetcher,base){this.fetcher=fetcher;this.base=base;this.status=null;this.history=null;this.statusTag=null;this.historyTag=null;this.pending=null;this.failed=false;}
 async get(path,tag){const r=await this.fetcher(this.base+path,{headers:tag?{'If-None-Match':tag}:{},cache:'no-store'});if(r.status===304){if(!tag)throw Error('unexpected 304');return {same:true};}if(!r.ok)throw Error('API '+r.status);const data=await r.json();const etag=r.headers.get('ETag');if(!etag)throw Error('missing ETag');return {data,etag};}
 async poll(){if(this.pending)return this.pending;this.pending=this.run().finally(()=>{this.pending=null});return this.pending;}
 async run(){
  let changed=false,historyChanged=false;
  try{
   const s=await this.get('/api/status',this.statusTag);
   if(!s.same){if(!Array.isArray(s.data?.results)||!Number.isFinite(Date.parse(s.data.generated_at)))throw Error('invalid status');if(this.status&&Date.parse(s.data.generated_at)<Date.parse(this.status.generated_at))throw Error('stale status revision');this.status=s.data;this.statusTag=s.etag;changed=true;}
   // Always let the server decide if history maintenance changed a revision.
   const suffix=this.history?'?since='+encodeURIComponent(this.history.revision):'';
   const h=await this.get('/api/history'+suffix,this.historyTag);
   if(!h.same){
    let full=h.data;
    if(full?.replace){const valid=this.history&&full.base_revision===this.history.revision&&Number.isSafeInteger(full.revision)&&full.revision>full.base_revision&&Array.isArray(full.remove)&&typeof full.full_etag==='string';
     if(!valid){const r=await this.get('/api/history',null);full=r.data;h.etag=r.etag;}
     else{const series={...this.history.series,...full.replace};for(const k of full.remove)delete series[k];h.etag=full.full_etag;full={schema:1,retention_days:30,revision:full.revision,as_of:full.as_of,series};}
    }
    if(!full||!Number.isSafeInteger(full.revision)||!full.series||typeof full.series!=='object'||Array.isArray(full.series))throw Error('invalid history');
    if(this.history&&full.revision<this.history.revision)throw Error('stale history revision');this.history=full;this.historyTag=h.etag;historyChanged=true;
   }
   this.failed=false;return {changed,historyChanged,status:this.status,history:this.history,stale:false};
  }catch{this.failed=true;return {changed,historyChanged,status:this.status,history:this.history,stale:true};}
 }
 interval({hidden=false,manualPending=false}={}){return manualPending?5000:hidden?300000:this.failed?120000:60000;}
}
