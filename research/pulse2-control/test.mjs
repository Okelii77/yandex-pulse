import {Miniflare} from 'miniflare';import {readFile,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';import {acquire,start,publish,history,tick,maintenance,manualTrigger,reserveBudget,consumeOidc,githubOidcIdentity,observationWindow,scheduledClaim,accountQuotaGuard,recoverUnsent,reconcileDispatch} from './dist/worker.js';
const mf=new Miniflare({modules:true,scriptPath:process.cwd()+'/dist/worker.js',compatibilityDate:'2026-07-01',d1Databases:{DB:'rc-control-local'},bindings:{RC_LOCAL_ONLY:'1',LOCAL_TOKEN:'fixture-only'},cf:false});const now=Math.floor(Date.now()/1800000)*1800000+1000;
const catalog=JSON.parse(await readFile('../../monitor/services.json','utf8'));const fixture=t=>({...catalog,generated_at:new Date(t).toISOString(),results:catalog.checks.map(c=>({id:c.id,status:c.kind==='music_ynison'||['maps-geocoder','ai-speech','ai-vision'].includes(c.id)?'disabled':'ok',checked_at:new Date(t).toISOString(),latency_ms:12}))});
const summary={};try{await mf.ready;const db=await mf.getD1Database('DB');for(const sql of (await readFile('schema.sql','utf8')).trim().split(/;\s*/).filter(Boolean))await db.prepare(sql).run();
 const t=now-31*86400000;
 const first=await Promise.all(Array.from({length:32},()=>acquire(db,t)));assert.equal(first.filter(Boolean).length,1);const claim=first.find(Boolean);
 assert.equal(await publish(db,claim,fixture(t),t),false);assert.equal(await start(db,{...claim,token:'wrong'},t),false);const starts=await Promise.all(Array.from({length:16},()=>start(db,claim,t)));assert.equal(starts.filter(Boolean).length,1);assert.equal(await publish(db,{...claim,token:'wrong'},fixture(t),t),false);assert(await publish(db,claim,fixture(t),t));assert.equal(await publish(db,claim,fixture(t),t),false);
 let dispatches=0;const mockEnv={DB:db,RC_LOCAL_ONLY:'1',RC_ENABLE_DISPATCH:'1',RC_GITHUB_TOKEN:'fixture-only'};const fake=async(url,opts)=>{assert.equal(JSON.parse(opts.body).ref,'research/pulse-architecture-20261128');dispatches++;return new Response(null,{status:503})};
 const next=t+1800000;assert.equal((await tick(mockEnv,next,fake)).action,'uncertain_wait_for_expiry');assert.equal((await tick(mockEnv,next+1,fake)).action,'skip');const retry=await acquire(db,next+600001);assert(retry);assert.equal(await start(db,claim,next+600001),false);assert(await start(db,retry,next+600001));assert(await publish(db,retry,fixture(next+600001),next+600001));
 const samples=[];const slots=48*31;
 // 31 virtual days; test all 34 catalog rows, no actual probes.
 for(let i=2;i<slots;i++){const v=t+i*1800000;const a=await acquire(db,v);assert(a);assert(await start(db,a,v));const began=performance.now();assert(await publish(db,a,fixture(v),v));samples.push(performance.now()-began)}
 const v=now,final=await acquire(db,v);assert(final);assert(await start(db,final,v));assert(await publish(db,final,fixture(v),v));await maintenance(db,v);
 const firstRead=await history(db,new Request('http://local/api/history'),v);assert.equal(firstRead.status,200);const old=await firstRead.json(),tag=firstRead.headers.get('ETag');assert.equal((await history(db,new Request('http://local/api/history',{headers:{'If-None-Match':tag}}),v)).status,304);
 const future=v+1800000;const reads=await Promise.all(Array.from({length:12},()=>history(db,new Request('http://local/api/history'),future)));assert(reads.some(r=>r.status===200));assert(reads.every(r=>[200,503].includes(r.status)));
 const full=await (await history(db,new Request('http://local/api/history'),future)).json();const delta=await (await history(db,new Request('http://local/api/history?since='+old.revision),future)).json();const reconstructed={...old.series,...delta.replace};for(const k of delta.remove)delete reconstructed[k];assert.deepEqual(reconstructed,full.series);
 const points=await (await history(db,new Request('http://local/api/history?format=points-v1&since='+old.revision),future)).json();
 if(points.format==='points-v1'){const merged=structuredClone(old.series);for(const k of points.remove)delete merged[k];for(const [k,patch] of Object.entries(points.patch)){const by=new Map((merged[k]||[]).map(x=>[x[0],x]));for(const stamp of patch.drop)by.delete(stamp);for(const x of patch.upsert)by.set(x[0],x);merged[k]=[...by.values()].sort((a,b)=>a[0].localeCompare(b[0]));}assert.deepEqual(merged,full.series);}else assert.deepEqual(points.series,full.series);
 summary.points_delta_compatible=true;
 const latest=await db.prepare('SELECT generated_at,revision FROM rc_latest').first();assert.equal(latest.generated_at,fixture(v).generated_at);
 const r=await mf.dispatchFetch('http://localhost/api/status');assert.equal(r.status,200);const s=await r.json();assert.equal(s.results.length,34);assert.equal((await mf.dispatchFetch('http://localhost/api/status',{headers:{'If-None-Match':r.headers.get('ETag')}})).status,304);assert.equal((await mf.dispatchFetch('http://localhost/api/rc/acquire',{method:'POST'})).status,401);
 const stats=await db.prepare('SELECT count(*) n FROM rc_samples').first();assert.equal(stats.n,(slots+1)*30);const counts=(await db.prepare('SELECT check_id,count(*) n FROM rc_samples GROUP BY check_id').all()).results;assert.equal(counts.length,30);assert(counts.every(x=>x.n===slots+1));for(const id of ['music-ynison','maps-geocoder','ai-speech','ai-vision'])assert(!counts.some(x=>x.check_id===id));samples.sort((a,b)=>a-b);Object.assign(summary,{virtual_slots:slots+1,publications:latest.revision,sample_rows:stats.n,lease_contenders:32,start_contenders:16,history_contenders:12,dispatches,publish_p50_ms:samples[Math.floor(samples.length/2)],publish_p95_ms:samples[Math.ceil(samples.length*.95)-1],history_revision:full.revision,passed:true});
 const manualEnv={DB:db,RC_LOCAL_ONLY:'1',RC_ENABLE_DISPATCH:'1',RC_GITHUB_TOKEN:'fixture-only',RC_ORIGIN:'https://staging.example',RC_TURNSTILE_SECRET:'fixture-secret',RC_TURNSTILE_SITE_KEY:'fixture-public'};
 let manualDispatches=0;const fakeManual=async(url,opts)=>{if(url.includes('siteverify'))return Response.json({success:opts.body.get('response')==='good',hostname:'staging.example',action:'pulse-rc-trigger'});manualDispatches++;return Response.json({workflow_run_id:456});};
 const request=(token,origin='https://staging.example')=>new Request('https://staging.example/api/trigger',{method:'POST',headers:{Origin:origin},body:JSON.stringify({turnstileToken:token})});
 const mt=v+3600000;assert.equal((await manualTrigger(request('good','https://wrong.example'),manualEnv,mt,fakeManual)).status,403);assert.equal((await manualTrigger(request('bad'),manualEnv,mt,fakeManual)).status,403);
 const manual=await Promise.all(Array.from({length:12},()=>manualTrigger(request('good'),manualEnv,mt,fakeManual)));assert.equal(manual.filter(x=>x.status===202).length,1);assert.equal(manualDispatches,1);assert.equal((await mf.dispatchFetch('http://localhost/api/ynison/acquire',{method:'POST'})).status,403);assert.equal((await (await mf.dispatchFetch('http://localhost/api/ynison/status')).json()).available,false);
 // Real RSA verification against isolated fixture JWKS; no live tokens.
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'fixture-key',use:'sig'};
 const ts=Math.floor(Date.now()/1000);const claims={iss:'https://token.actions.githubusercontent.com',aud:'yandex-pulse-rc-ingest',repository:'Okelii77/yandex-pulse',repository_id:'1427282907',repository_owner_id:'108305520',ref:'refs/heads/research/pulse-architecture-20261128',environment:'pulse-rc',event_name:'workflow_dispatch',workflow_ref:'Okelii77/yandex-pulse/.github/workflows/pulse2-rc-dispatch.yml@refs/heads/research/pulse-architecture-20261128',sub:'repo:Okelii77@108305520/yandex-pulse@1427282907:environment:pulse-rc',run_id:'123',run_attempt:'1',jti:'fixture-jti-123',iat:ts,nbf:ts,exp:ts+300};
 const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
 const sign=async c=>{const text=enc({alg:'RS256',kid:'fixture-key'})+'.'+enc(c);return text+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(text))).toString('base64url');};
 const load=async(url,init)=>{assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');assert.equal(init.redirect,'manual');assert(init.signal instanceof AbortSignal);return Response.json({keys:[jwk]});};const id=await githubOidcIdentity(await sign(claims),ts*1000,load);assert(id&&id.owner==='123:1');assert(await consumeOidc(db,id));assert.equal(await consumeOidc(db,id),false);
 for(const patch of [{iss:'wrong'},{aud:'wrong'},{repository_id:'1'},{repository:'wrong/repo'},{ref:'refs/heads/main'},{environment:'production'},{event_name:'push'},{workflow_ref:'wrong'},{sub:'wrong'},{sub:'repo:Okelii77/yandex-pulse:environment:pulse-rc'},{repository_owner_id:'1'},{sub:'repo:Okelii77@1/yandex-pulse@1427282907:environment:pulse-rc'},{exp:ts-1},{nbf:ts+999},{jti:''}])assert.equal(await githubOidcIdentity(await sign({...claims,...patch}),ts*1000,load),null);
 const traceCases=[];
 for(const [name,loader,expected] of [
  ['fetch',async()=>{throw new TypeError('fixture secret');},'jwks_fetch_exception'],
  ['http',async()=>new Response('',{status:503}),'jwks_http_rejected'],
  ['redirect',async()=>new Response('',{status:302,headers:{Location:'https://untrusted.invalid/keys'}}),'jwks_http_rejected'],
  ['non200',async()=>new Response('',{status:201}),'jwks_http_rejected'],
  ['json',async()=>new Response('invalid json'),'jwks_json_exception'],
  ['kid',async()=>Response.json({keys:[]}), 'jwks_key_missing'],
  ['import',async()=>Response.json({keys:[{...jwk,key_ops:['sign'],alg:'RS512'}]}),'rsa_import_exception'],
 ]){
  const trace=[];assert.equal(await githubOidcIdentity(await sign(claims),ts*1000,loader,(code,status)=>trace.push({code,status})),null);assert.equal(trace.at(-1).code,expected,name);traceCases.push(name);
 }
 const invalidSignature=(await sign(claims)).split('.');invalidSignature[2]='A'.repeat(invalidSignature[2].length);
 const badTrace=[];assert.equal(await githubOidcIdentity(invalidSignature.join('.'),ts*1000,load,c=>badTrace.push(c)),null);assert.equal(badTrace.at(-1),'rsa_signature_invalid');
 summary.oidc_stage_cases=traceCases.length+1;
 const cache={keys:[],expires:0,refreshed:0};let loads=0;const counted=async(...args)=>{loads++;return load(...args)};
 assert(await githubOidcIdentity(await sign(claims),ts*1000,counted,()=>{},cache));
 assert(await githubOidcIdentity(await sign(claims),ts*1000+1000,counted,()=>{},cache));assert.equal(loads,1);

 const other=(await sign(claims)).split('.');other[0]=enc({alg:'RS256',kid:'new-key'});
 let refreshes=0;const reload=async()=>{refreshes++;return Response.json({keys:[jwk]})};
 assert.equal(await githubOidcIdentity(other.join('.'),ts*1000+6000,reload,()=>{},cache),null);assert.equal(refreshes,1);
 assert.equal(await githubOidcIdentity(other.join('.'),ts*1000+7000,reload,()=>{},cache),null);assert.equal(refreshes,1);
  const staleTrace=[];assert.equal(await githubOidcIdentity(await sign(claims),ts*1000+67000,async()=>{throw Error('offline')},c=>staleTrace.push(c),cache),null);assert.equal(staleTrace.at(-1),'jwks_fetch_exception');
 summary.jwks_cache_ttl=true;summary.jwks_unknown_kid_throttle=true;

 const bd=v+40*86400000;const reservations=await Promise.all(Array.from({length:12},()=>reserveBudget(db,bd,0,1,10,1,3)));assert.equal(reservations.filter(Boolean).length,3);assert.equal(await reserveBudget(db,bd,4001),false);assert.equal(await reserveBudget(db,bd,0,0,1500001),false);assert.equal(await reserveBudget(db,bd,0,0,0,12001),false);
 summary.oidc_claim_rejection_cases=15;summary.oidc_replay_rejected=true;summary.budget_atomic=true;
 const old91=new Date(v-91*86400000).toISOString(),old31=new Date(v-31*86400000-1800000).toISOString();await db.prepare('INSERT INTO rc_samples VALUES(?,?,?,?)').bind('music-web',old91,'ok',1).run();await db.prepare('INSERT INTO rc_samples VALUES(?,?,?,?)').bind('music-web',old31,'ok',1).run();await maintenance(db,v);assert.equal((await db.prepare('SELECT COUNT(*) n FROM rc_samples WHERE checked_at=?').bind(old91).first()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM rc_samples WHERE checked_at=?').bind(old31).first()).n,1);const hist=(await (await history(db,new Request('http://local/api/history'),v+3600000)).json()).series;assert(Object.values(hist).flat().every(x=>Date.parse(x[0])>=v+3600000-1800000-30*86400000));summary.retention_90_30=true;
 summary.manual_dispatches=manualDispatches;summary.excluded_components=['music-ynison','maps-geocoder','ai-speech','ai-vision'];summary.rows_per_component=slots+1;
 const owned=await acquire(db,bd+1800000,'owner-a');assert(owned);assert.equal(await start(db,owned,bd+1800000,'owner-b'),false);assert(await start(db,owned,bd+1800000,'owner-a'));assert.equal(await publish(db,owned,fixture(bd+1800000),bd+1800000,'owner-b'),false);assert(await publish(db,owned,fixture(bd+1800000),bd+1800000,'owner-a'));summary.owner_fencing=true;
 const windowStart=Math.floor((v+50*86400000)/1800000)*1800000;
 const windowEnv={DB:db,RC_MODE:'synthetic',RC_OBSERVE_START:String(windowStart),RC_OBSERVE_END:String(windowStart+7*86400000),RC_ENABLE_DISPATCH:'1',RC_GITHUB_TOKEN:'fixture-only',RC_MAX_LAUNCHES:'1',RC_PINNED_SHA:'b'.repeat(40),RC_CF_ACCOUNT_ID:'a'.repeat(32),RC_CF_ANALYTICS_TOKEN:'fixture-only'};
 assert.equal(observationWindow(windowEnv,windowStart-1).active,false);assert(observationWindow(windowEnv,windowStart).active);assert.equal(observationWindow(windowEnv,windowStart+7*86400000).active,false);
 assert.equal((await tick(windowEnv,windowStart-1,fake)).action,'outside_window');
 const analytics=(requests=100,reads=1000,writes=100)=>Response.json({data:{viewer:{accounts:[{workersInvocationsAdaptive:[{sum:{requests}}],d1AnalyticsAdaptiveGroups:[{sum:{rowsRead:reads,rowsWritten:writes}}]}]}}});
 assert.equal(await accountQuotaGuard({...windowEnv,RC_CF_ANALYTICS_TOKEN:''},windowStart,async()=>{throw Error('must not request')}),'analytics_not_configured');
 assert.equal(await accountQuotaGuard(windowEnv,windowStart,async()=>new Response('',{status:503})),'analytics_unavailable');
 const dispatchFixture=async(url,opts)=>{if(url==='https://api.cloudflare.com/client/v4/graphql')return analytics();const body=JSON.parse(opts.body);assert.match(body.inputs.lease,/^[a-f0-9-]{36}$/);assert.equal(opts.redirect,'manual');return Response.json({workflow_run_id:789});};
 assert.equal((await tick(windowEnv,windowStart,dispatchFixture)).action,'accepted');
 assert.equal(await scheduledClaim(db,windowStart,'123:1',windowStart),null);
 assert.equal(await scheduledClaim(db,windowStart,'789:2',windowStart),null);
 const scheduled=await scheduledClaim(db,windowStart,'789:1',windowStart);assert(scheduled);
 assert.equal(await start(db,scheduled,windowStart,'123:1',true),false);
 assert(await start(db,scheduled,windowStart,'789:1',true));
 assert(await publish(db,scheduled,fixture(windowStart),windowStart,'789:1'));summary.dispatch_run_id_fencing=true;
 assert.equal((await tick(windowEnv,windowStart+600001,fake)).action,'skip');
 assert.equal((await tick(windowEnv,windowStart+1800000,fake)).action,'skip');
 assert.equal((await db.prepare('SELECT count(*) n FROM rc_lease WHERE slot=?').bind(windowStart+1800000).first()).n,0);
 assert.equal((await tick(windowEnv,windowStart+7*86400000,fake)).action,'outside_window');summary.observation_window_and_atomic_budget=true;
 const nextWindow=windowStart+8*86400000,quotaEnv={...windowEnv,RC_OBSERVE_START:String(nextWindow),RC_OBSERVE_END:String(nextWindow+7*86400000)};
 assert.equal(await accountQuotaGuard(quotaEnv,nextWindow,async()=>analytics(70000)),'quota_paused');
 assert.equal(await accountQuotaGuard(quotaEnv,nextWindow+1,async()=>{throw Error('paused must not request')}),'quota_paused');
 assert.equal((await tick(quotaEnv,nextWindow+2,async()=>{throw Error('paused must not dispatch')})).action,'quota_paused');
 summary.shared_quota_guard=true;
 const recoverSlot=windowStart+86400000;
 const unsent=await acquire(db,recoverSlot);assert(unsent);
 const recovered=await Promise.all(Array.from({length:8},()=>recoverUnsent(db,recoverSlot,recoverSlot+600001)));assert.equal(recovered.filter(Boolean).length,1);
 assert.equal(await start(db,unsent,recoverSlot+600002,'fixture'),false);
 const rec=recovered.find(Boolean);assert(rec&&rec.token!==unsent.token);
 const uncertainSlot=recoverSlot+1800000;
 const uncertainEnv={...windowEnv,RC_MAX_LAUNCHES:'48'};
 const uncertain=await tick(uncertainEnv,uncertainSlot,async(url)=>{if(url.includes('graphql'))return analytics();throw Error('network after POST');});
 assert.equal(uncertain.action,'uncertain_wait_for_expiry');
 const row=await db.prepare('SELECT dispatch_id FROM rc_lease WHERE slot=?').bind(uncertainSlot).first();assert(row.dispatch_id);
 let posts=0;
 const reconciliation=async(url,opts)=>{if(url.includes('graphql'))return analytics();if(opts.method==='POST'){posts++;throw Error('must not resend');}return Response.json({workflow_runs:[{id:987,run_attempt:1,display_title:'RC2 '+uncertainSlot+' '+row.dispatch_id,head_sha:uncertainEnv.RC_PINNED_SHA,head_branch:'research/pulse-architecture-20261128',event:'workflow_dispatch',path:'.github/workflows/pulse2-rc-dispatch.yml',created_at:new Date(uncertainSlot).toISOString(),status:'queued'}]});};
 assert.equal((await tick(uncertainEnv,uncertainSlot+600001,reconciliation)).action,'reconciled');assert.equal(posts,0);
 assert.equal(await scheduledClaim(db,uncertainSlot,'123:1',uncertainSlot+600002),null);
 const repaired=await scheduledClaim(db,uncertainSlot,'987:1',uncertainSlot+600002);assert(repaired);assert(await start(db,repaired,uncertainSlot+600002,'987:1',true));assert(await publish(db,repaired,fixture(uncertainSlot+600002),uncertainSlot+600002,'987:1'));
 summary.safe_unsent_recovery=true;summary.ambiguous_reconcile_no_resend=true;
 assert.equal(await githubOidcIdentity(await sign(claims),ts*1000,load,()=>{},null,'b'.repeat(40)),null);
 assert(await githubOidcIdentity(await sign({...claims,sha:'b'.repeat(40),workflow_sha:'b'.repeat(40)}),ts*1000,load,()=>{},null,'b'.repeat(40)));
 summary.pinned_oidc_sha=true;
 const oneSlot={...windowEnv,RC_OBSERVE_START:'',RC_OBSERVE_END:'',RC_PREFLIGHT_SLOT:String(windowStart),RC_MAX_LAUNCHES:'1'};
 assert(observationWindow(oneSlot,windowStart).active);assert(!observationWindow(oneSlot,windowStart+1800000).active);assert(!observationWindow({...oneSlot,RC_MAX_LAUNCHES:'48'},windowStart).valid);
 assert(!observationWindow({...oneSlot,RC_OBSERVE_START:String(windowStart)},windowStart).valid);
 summary.one_slot_preflight=true;
 await writeFile('control-results.json',JSON.stringify(summary,null,2));console.log('RC_CONTROL',JSON.stringify(summary));
}finally{await mf.dispose();}
