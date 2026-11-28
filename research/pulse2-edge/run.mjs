import {Miniflare} from 'miniflare';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {performance} from 'node:perf_hooks';import {execFileSync} from 'node:child_process';import {init,acquire,tick,finish} from './scheduler.mjs';
const root=process.cwd();const variants=[['js','worker.mjs'],['ts','dist/worker.js'],['hybrid','dist/hybrid.js'],['rust','rust-worker/build/worker/shim.mjs']];
const percentile=(a,p)=>{const z=[...a].sort((a,b)=>a-b);return z[Math.ceil(p*z.length)-1]};
function procs(){const rows=execFileSync('ps',['-eo','pid=,ppid=,comm='],{encoding:'utf8'}).trim().split('\n').map(s=>s.trim().split(/\s+/));let ids=new Set([String(process.pid)]);for(let i=0;i<8;i++)for(const [pid,ppid] of rows)if(ids.has(ppid))ids.add(pid);return rows.filter(([pid,,name])=>ids.has(pid)&&name==='workerd').map(([pid])=>pid);}
async function cpu(){let out={};for(const pid of procs()){try{const s=await fs.readFile('/proc/'+pid+'/stat','utf8');const fields=s.slice(s.lastIndexOf(')')+2).split(' ');const status=await fs.readFile('/proc/'+pid+'/status','utf8');out[pid]={ticks:+fields[11]+ +fields[12],hwm_kib:+(status.match(/^VmHWM:\s+(\d+)/m)?.[1]||0)};}catch{}}return out;}
const hz=+execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim();const output=[];
for(const [name,path] of variants){const start=performance.now();const mf=new Miniflare({modules:true,scriptPath:root+'/'+path,compatibilityDate:'2026-07-01',d1Databases:{DB:'pulse2-local-'+name},cf:false,modulesRules:[{type:'CompiledWasm',include:['**/*.wasm']},{type:'ESModule',include:['**/*.js','**/*.mjs']}]});
 try{await mf.ready;const startup=performance.now()-start;const db=await mf.getD1Database('DB');
 await db.prepare('CREATE TABLE lab_values(id INTEGER PRIMARY KEY,v INTEGER NOT NULL)').run();
 await db.prepare('WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM seq WHERE i<4096) INSERT INTO lab_values SELECT i,i%1000 FROM seq').run();
 const expected={count:4096,sum:Array.from({length:4096},(_,i)=>(i+1)%1000).reduce((a,b)=>a+b,0)};
 async function request(){const t=performance.now();const r=await mf.dispatchFetch('http://localhost/');assert.equal(r.status,200);assert.deepEqual(await r.json(),expected);return performance.now()-t;}
 const first=await request();for(let i=0;i<5;i++)await request();const before=await cpu();const samples=[];for(let i=0;i<100;i++)samples.push(await request());const after=await cpu();let ticks=0,matched=0;for(const [pid,v] of Object.entries(after))if(before[pid]){ticks+=v.ticks-before[pid].ticks;matched++;}
 output.push({name,startup_ms:startup,first_request_after_seed_ms:first,samples_ms:samples,p50_ms:percentile(samples,.5),p95_ms:percentile(samples,.95),p99_ms:percentile(samples,.99),workerd_process_cpu_ms:matched?ticks*1000/hz:null,workerd_process_hwm_kib:Object.values(after).map(v=>v.hwm_kib),clock_ticks_per_second:hz,entry_bytes:(await fs.stat(path)).size});
 if(name==='js'){
  await init(db);const t=1795852800;const claims=await Promise.all(Array.from({length:32},()=>acquire(db,t)));assert.equal(claims.filter(Boolean).length,1);const c=claims.find(Boolean);assert.equal(await finish(db,{...c,token:'wrong'},t),false);assert.equal(await finish(db,c,t),true);assert.equal(await finish(db,c,t),false);let dispatches=0;const ts=t+1800;const r=await tick(db,ts,async()=>{dispatches++;throw Error('fixture failure')});assert.equal(r.action,'dispatch_failed_lease_expires');assert.equal((await tick(db,ts+1,async()=>dispatches++)).action,'skip');assert.equal((await tick(db,ts+301,async()=>dispatches++)).action,'dispatched');assert.equal(dispatches,2);
  const history=await historyLab(db);await fs.writeFile('evidence/d1-local.json',JSON.stringify({scheduler:{claims:32,winners:1,dispatches,passed:true},history},null,2));
 }
 }finally{await mf.dispose();}
}
await fs.writeFile('evidence/edge-results.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output.map(({samples_ms,...x})=>x)));
async function historyLab(db){
 await db.prepare('CREATE TABLE lab_history(id INTEGER,t INTEGER,v INTEGER,PRIMARY KEY(id,t))').run();await db.prepare('CREATE TABLE lab_snapshot(id INTEGER PRIMARY KEY,payload TEXT NOT NULL CHECK(length(payload)>1))').run();
 await db.prepare('WITH RECURSIVE ids(i) AS(SELECT 1 UNION ALL SELECT i+1 FROM ids WHERE i<34),slots(t) AS(SELECT 1 UNION ALL SELECT t+1 FROM slots WHERE t<1440) INSERT INTO lab_history SELECT i,t,(i+t)%1000 FROM ids CROSS JOIN slots').run();
 const query="SELECT json_group_array(json_array(id,t,v)) AS payload FROM (SELECT id,t,v FROM lab_history WHERE t%12=0 ORDER BY id,t)";
 const aggregate=await db.prepare(query).all();const materialized=await db.prepare("INSERT INTO lab_snapshot SELECT 1,payload FROM ("+query+")").run();
 const snapshot=await db.prepare('SELECT payload FROM lab_snapshot WHERE id=1').all();assert.equal(snapshot.results[0].payload,aggregate.results[0].payload);
 let rolled=false;try{await db.batch([db.prepare('DELETE FROM lab_history'),db.prepare("UPDATE lab_snapshot SET payload='' WHERE id=1")]);}catch{rolled=true;}assert(rolled);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM lab_history').first()).n,48960);
 const rows=[];for(const [mode,sql] of [['aggregate',query],['materialized','SELECT payload FROM lab_snapshot WHERE id=1']]){const samples=[];let meta;for(let i=0;i<20;i++){const t=performance.now();const r=await db.prepare(sql).all();assert.equal(r.results[0].payload,snapshot.results[0].payload);samples.push(performance.now()-t);meta=r.meta;}rows.push({mode,samples_ms:samples,p50_ms:percentile(samples,.5),meta});}
 return {rows:48960,materialization_meta:materialized.meta,rollback:rolled,comparisons:rows};
}
