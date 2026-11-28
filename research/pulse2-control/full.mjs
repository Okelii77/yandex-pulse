// Native composed payload -> local workerd/D1 HTTP -> real dashboard. No external calls.
import {Miniflare} from 'miniflare';import assert from 'node:assert/strict';import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {tmpdir} from 'node:os';import {join,extname} from 'node:path';import {setTimeout as sleep} from 'node:timers/promises';import {performance} from 'node:perf_hooks';
const out=[];
for(const lang of ['rust','go']){
 const mf=new Miniflare({modules:true,scriptPath:process.cwd()+'/dist/worker.js',compatibilityDate:'2026-07-01',d1Databases:{DB:'rc-full-'+lang},bindings:{RC_LOCAL_ONLY:'1',LOCAL_TOKEN:'fixture-only'},cf:false});
 let chrome,ws,server,profile;try{
  await mf.ready;const db=await mf.getD1Database('DB');for(const sql of (await readFile('schema.sql','utf8')).trim().split(/;\s*/).filter(Boolean))await db.prepare(sql).run();
  const source=JSON.parse(await readFile('../pulse2-rc/fixture-status-'+lang+'.json','utf8'));
  assert.equal(source.results.length,34);
  const stamp=new Date().toISOString();const fixture={...source,generated_at:stamp,results:source.results.map(r=>({...r,checked_at:r.id==='music-web'?new Date(Date.now()-3*3600000).toISOString():stamp}))};
  const post=async(path,body)=>mf.dispatchFetch('http://local'+path,{method:'POST',headers:{Authorization:'Bearer fixture-only','Content-Type':'application/json'},body:JSON.stringify(body)});
  const t=performance.now();const a=await post('/api/rc/acquire',{});assert.equal(a.status,200);const claim=await a.json();assert.equal((await post('/api/rc/start',{claim})).status,200);assert.equal((await post('/api/rc/start',{claim})).status,409);
  const ing=await post('/api/rc/ingest',{claim,payload:fixture});assert.equal(ing.status,200);const published=performance.now()-t;
  const seen=await mf.dispatchFetch('http://local/api/status');assert.equal(seen.status,200);assert.deepEqual((await seen.json()).results.map(r=>[r.id,r.status]),source.results.map(r=>[r.id,r.status]));
  const api=performance.now()-t;
  let origin;const calls=[];const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};
  server=createServer(async(req,res)=>{
    try{const u=new URL(req.url,origin);
    if(u.pathname.startsWith('/api/')){const r=await mf.dispatchFetch('http://local'+u.pathname+u.search,{headers:req.headers['if-none-match']?{'If-None-Match':req.headers['if-none-match']}:{}});const bytes=Buffer.from(await r.arrayBuffer());calls.push({path:u.pathname,status:r.status,bytes:bytes.length});res.writeHead(r.status,{'Content-Type':'application/json',...(r.headers.get('ETag')?{ETag:r.headers.get('ETag')}:{})});return res.end(bytes);}
    if(u.pathname==='/api-config.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end('window.PULSE_API_CONFIG='+JSON.stringify({apiUrl:origin,localFixture:true})+';');}
    if(u.pathname==='/status.json'||u.pathname==='/history.json'){res.writeHead(503);return res.end();}
    const f=u.pathname==='/'?'index.html':u.pathname.slice(1);if(!/^[a-zA-Z0-9_.-]+$/.test(f)){res.writeHead(404);return res.end();}
    const b=await readFile(new URL('../../site/'+f,import.meta.url));res.writeHead(200,{'Content-Type':mime[extname(f)]||'application/octet-stream'});res.end(b);
    }catch{res.writeHead(404);res.end();}
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
  profile=await mkdtemp(join(tmpdir(),'pulse-rc-chrome-'));chrome=spawn('google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-gpu','--no-first-run','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
  async function until(fn){for(let i=0;i<150;i++){try{const v=await fn();if(v)return v}catch{}await sleep(50)}throw Error('timeout')}
  const port=await until(async()=>Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]));const target=await (await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})).json();ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
  let id=0;const pending=new Map();const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Fetch.requestPaused'){const p=m.params,ok=p.request.url.startsWith(origin+'/');send(ok?'Fetch.continueRequest':'Fetch.failRequest',ok?{requestId:p.requestId}:{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{})}});
  const evalJS=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value};
  await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const bt=performance.now();await send('Page.navigate',{url:origin+'/#/'});
  await until(()=>evalJS("document.querySelectorAll('.service-card').length===34&&document.querySelector('.data-health-title')?.textContent==='Данные получены из Live API'&&!document.querySelector('#refresh-button').disabled"));
  const rendered=performance.now()-bt;assert(await evalJS("document.querySelector('[data-check=music-web]').textContent.includes('Данные устарели')"));
  const before=calls.length;const second=await evalJS("window.PulseLive.snapshot().then(x=>({fresh:x.historyFresh,rows:x.status.results.length}))");assert.deepEqual(second,{fresh:true,rows:34});const added=calls.slice(before);assert(added.some(x=>x.path==='/api/status'&&x.status===304));assert(added.some(x=>x.path==='/api/history'&&x.status===304));assert(added.filter(x=>x.status===304).every(x=>x.bytes===0));
  out.push({language:lang,components:34,acquire_start_ingest_ms:published,acquire_to_api_ms:api,browser_navigation_to_cards_ms:rendered,conditional_requests:added,per_component_stale:true,passed:true});
 }finally{ws?.close();chrome?.kill();server?.close();await mf.dispose();if(profile){await sleep(150);await rm(profile,{recursive:true,force:true}).catch(()=>{})}}
}
await writeFile('full-results.json',JSON.stringify(out,null,2));console.log('RC_FULL',JSON.stringify(out));
