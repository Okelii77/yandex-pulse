// One real Chrome navigation, only exact staging origin allowed. No service requests or challenges.
import {spawn} from 'node:child_process';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {setTimeout as sleep} from 'node:timers/promises';import assert from 'node:assert/strict';
const origin='https://yandex-pulse-rc2.oleg-pulse-03.workers.dev',profile=await mkdtemp(join(tmpdir(),'pulse-rc2-cloud-'));
const child=spawn('google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-extensions','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
let ws;try{
 const until=async(fn)=>{for(let i=0;i<200;i++){try{const x=await fn();if(x)return x}catch{}await sleep(100)}throw Error('browser readiness timeout')};
 const port=await until(async()=>Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]));
 const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();const target=pages.find(x=>x.type==='page');assert(target);
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
 let id=0,requests=0,blocked=0;const pending=new Map(),send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='Fetch.requestPaused'){const p=m.params,allowed=p.request.url.startsWith(origin+'/')&&requests<40;if(allowed)requests++;else blocked++;send(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:p.requestId}:{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{})}});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value};
 await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 const started=performance.now();await send('Page.navigate',{url:origin+'/#/'});
 await until(()=>evaluate("document.querySelectorAll('.service-card').length===34&&document.querySelector('.data-health-title')?.textContent==='Данные получены из Live API'&&!document.querySelector('#refresh-button').disabled"));
 const current=await evaluate("(async()=>{const x=await window.PulseLive.snapshot();return {generated:x.status.generated_at,revision:x.history?.revision,historyFresh:x.historyFresh,points:Object.values(x.history?.series||{}).reduce((n,a)=>n+a.length,0)}})()");
 assert.equal(current.generated,'2026-11-28T15:52:50.000Z');assert(current.revision.startsWith('2-'));assert.equal(current.points,60);assert(current.historyFresh);
 // Restore the actual retained rev1 history as the browser's initial cache, then let the real API serve the delta.
 const cached=JSON.parse(await readFile('research/pulse2-control/history-rev1-fixture.json','utf8'));
 const delta=await evaluate(`(async()=>{const src=await (await fetch('/live-api.js')).text();const saved=window.fetch;let first=true,used=false;window.fetch=async (url,opts)=>{if(String(url).includes('/api/history')&&first){first=false;return new Response(${JSON.stringify(JSON.stringify(cached))},{headers:{ETag:'"h-'+${JSON.stringify(cached.revision)}+'"'}});}if(String(url).includes('/api/history?since='))used=true;return saved(url,opts);};try{(0,eval)(src);await window.PulseLive.snapshot();const x=await window.PulseLive.snapshot();return {used,revision:x.history?.revision,points:Object.values(x.history?.series||{}).reduce((n,a)=>n+a.length,0),fresh:x.historyFresh};}finally{window.fetch=saved;}})()`);
 assert(delta.used&&delta.fresh&&delta.revision.startsWith('2-')&&delta.points===60);console.log('RC2_BROWSER_DELTA',JSON.stringify({current,delta}));
 const detail=await evaluate("({cards:document.querySelectorAll('.service-card').length,staging:document.body.textContent.includes('Только синтетические данные'),resources:performance.getEntriesByType('resource').length,version:document.title})");
 assert.equal(detail.cards,34);assert(detail.staging);assert(detail.version.includes('STAGING'));
 console.log('RC2_CLOUD_BROWSER',JSON.stringify({...detail,render_ms:Math.round(performance.now()-started),requests,blocked}));
}finally{ws?.close();child.kill();await sleep(100);await rm(profile,{recursive:true,force:true}).catch(()=>{})}
