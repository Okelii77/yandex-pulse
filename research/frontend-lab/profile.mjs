// Real Chrome smoke test: loopback-only synthetic data; no production API or credentials.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {mkdtemp,readFile,writeFile,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,extname} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
const root=new URL("../../site/",import.meta.url);
const stamp=new Date().toISOString();
const catalog=JSON.parse(await readFile(new URL("../../monitor/services.json",import.meta.url),"utf8"));
const sample={...catalog,generated_at:stamp,results:catalog.checks.map((c,i)=>({id:c.id,status:i%11===0?"down":"ok",checked_at:stamp,latency_ms:100+i}))};
const history={schema:1,series:Object.fromEntries(catalog.checks.map((c,i)=>[c.id,Array.from({length:214},(_,j)=>[new Date(Date.parse(stamp)-(213-j)*3600000*3).toISOString(),j%19===0?"down":"ok",100+i+j%40])]))};
const mime={".html":"text/html; charset=utf-8",".css":"text/css",".js":"text/javascript",".mjs":"text/javascript",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".webmanifest":"application/manifest+json"};
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,"http://localhost").pathname;
  try{
    if(pathname==="/status.json"||pathname==="/history.json"||pathname==="/api-config.js"){
      const js=pathname.endsWith(".js");
      res.writeHead(200,{"Content-Type":js?mime[".js"]:mime[".json"]});
      return res.end(js?"window.PULSE_API_CONFIG=location.search.includes('live=1')?{apiUrl:'https://pulse.test'}:{};":JSON.stringify(pathname==="/status.json"?sample:history));
    }
    const name=pathname==="/"?"index.html":pathname.slice(1);
    if(!/^[a-zA-Z0-9_.-]+$/.test(name)){res.writeHead(404);return res.end();}
    const content=await readFile(new URL(name,root));
    res.writeHead(200,{"Content-Type":mime[extname(name)]||"application/octet-stream"});
    res.end(content);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin="http://127.0.0.1:"+server.address().port;
const profile=await mkdtemp(join(tmpdir(),"pulse-chrome-"));
const out="/tmp/pulse-ui-preview";
await mkdir(out,{recursive:true});
const chrome=spawn(process.env.CHROME_BIN||"google-chrome",["--headless=new","--no-sandbox","--disable-dev-shm-usage","--disable-background-networking","--disable-gpu","--no-first-run","--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],{stdio:"ignore"});
let ws;
const until=async(fn,description)=>{
  for(let i=0;i<100;i++){try{const result=await fn();if(result)return result;}catch{}await sleep(100);}
  throw Error("Timeout: "+description);
};
try{
  const port=await until(async()=>Number((await readFile(join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0]),"Chrome startup");
  const target=await (await fetch("http://127.0.0.1:"+port+"/json/new?about:blank",{method:"PUT"})).json();
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener("open",resolve,{once:true});ws.addEventListener("error",reject,{once:true});});
  let id=0;
  const pending=new Map(),errors=[];
  ws.addEventListener("message",event=>{
    const m=JSON.parse(event.data);
    if(m.id&&pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(Error(m.error.message)):resolve(m.result);}
    if(m.method==="Runtime.exceptionThrown")errors.push(m.params.exceptionDetails.text);
    if(m.method==="Log.entryAdded"&&m.params.entry.level==="error")errors.push(m.params.entry.text);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const evalJS=async expression=>{
    const r=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw Error(r.exceptionDetails.text);
    return r.result.value;
  };
  await send("Page.enable");await send("Runtime.enable");await send("Log.enable");
  const wait=async expression=>{
    try{return await until(()=>evalJS(expression),expression);}
    catch(e){
      console.log("Browser diagnostic:",JSON.stringify({errors,document:await evalJS("({url:location.href,title:document.title,ready:document.readyState,text:document.body?.innerText?.slice(0,900)})").catch(()=>null)}));
      await shot("failure").catch(()=>{});
      throw e;
    }
  };
  const click=selector=>evalJS("document.querySelector("+JSON.stringify(selector)+").click()");
  const shot=async name=>{const r=await send("Page.captureScreenshot",{format:"png"});await writeFile(join(out,name+".png"),Buffer.from(r.data,"base64"));};
  await send("Performance.enable");await send("Network.enable");await send("Network.setCacheDisabled",{cacheDisabled:true});
  // Block all external browser requests, including fonts and third-party scripts.
  await send("Network.setBlockedURLs",{urls:["https://*","http://*"]});
  // CDP wildcard blocking would also block loopback; use Fetch interception instead.
  await send("Network.setBlockedURLs",{urls:[]});
  ws.addEventListener("message",event=>{const m=JSON.parse(event.data);if(m.method==="Fetch.requestPaused"){const p=m.params;const allowed=p.request.url.startsWith(origin+"/");send(allowed?"Fetch.continueRequest":"Fetch.failRequest",allowed?{requestId:p.requestId}:{requestId:p.requestId,errorReason:"BlockedByClient"}).catch(()=>{});}});
  await send("Fetch.enable",{patterns:[{urlPattern:"*"}]});
  const rows=[];
  const metrics=async()=>Object.fromEntries((await send("Performance.getMetrics")).metrics.map(x=>[x.name,x.value]));
  for(const [device,width,height] of [["desktop",1440,900],["mobile",390,844]]){
    await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});
    for(let i=0;i<11;i++){
      const t=performance.now();
      await send("Page.navigate",{url:origin+"/?bench="+device+"-"+i+"#/"});
      await wait("document.readyState==='complete'&&document.querySelectorAll('.service-card').length==="+catalog.checks.length+"&&!document.querySelector('#refresh-button').disabled");
      const ready=performance.now()-t;
      const page=await evalJS(`(()=>{const nav=performance.getEntriesByType("navigation")[0];const r=performance.getEntriesByType("resource").filter(x=>x.name.startsWith(location.origin));return {dom_content_loaded_ms:nav.domContentLoadedEventEnd,load_ms:nav.loadEventEnd,resources:r.length,transfer_bytes:r.reduce((a,x)=>a+x.transferSize,0)+nav.transferSize,js_encoded_bytes:r.filter(x=>/\\.m?js(?:\\?|$)/.test(x.name)).reduce((a,x)=>a+x.encodedBodySize,0),cards:document.querySelectorAll('.service-card').length}})()`);
      const pre=await metrics();
      await click('[data-check="music-ynison"]');
      await wait("!document.querySelector('#modal-backdrop').hidden");
      const graph=await evalJS(`(async()=>{const results=[];for(const n of [168,24,168,24,168]){const el=document.querySelector('[data-range="'+n+'"]');if(!el)throw Error('range button missing');const s=performance.now();el.click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));results.push(performance.now()-s)}return results})()`);
      const post=await metrics();
      if(i)rows.push({device,iteration:i,ready_ms:ready,...page,heap_bytes:post.JSHeapUsedSize,graph_frame_ms:graph,script_seconds:post.ScriptDuration-pre.ScriptDuration,layout_seconds:post.LayoutDuration-pre.LayoutDuration});
    }
  }
  const outPath=new URL("./frontend-results.json",import.meta.url);
  await writeFile(outPath,JSON.stringify(rows,null,2));
  console.log("FRONTEND_RESULTS",JSON.stringify(rows));
  assert.equal(rows.length,20);
}finally{
  ws?.close();chrome.kill();server.close();await sleep(300);
  await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
