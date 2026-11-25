// Real Chrome smoke test: loopback-only synthetic data; no production API or credentials.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {mkdtemp,readFile,writeFile,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,extname} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
const root=new URL("../site/",import.meta.url);
const stamp=new Date().toISOString();
const sample={generated_at:stamp,interval_minutes:30,
  categories:[{id:"music",title:"Музыка",icon:"music",description:"API музыки"},{id:"cloud",title:"Облако",icon:"cloud",description:"Облачные API"}],
  checks:[{id:"music-rest",category:"music",name:"Music REST",detail:"Авторизованный API",kind:"music_rest"},{id:"music-ynison",category:"music",name:"Ynison",detail:"Состояние плеера",kind:"music_ynison"},{id:"cloud-api",category:"cloud",name:"Cloud API",detail:"API инфраструктуры",kind:"http"}],
  results:[{id:"music-rest",status:"ok",checked_at:stamp,latency_ms:100},{id:"music-ynison",status:"disabled",checked_at:stamp,latency_ms:null},{id:"cloud-api",status:"down",checked_at:stamp,latency_ms:340}]};
const history={series:{"music-rest":[[stamp,"ok",100]],"cloud-api":[[stamp,"down",340]]}};
const mime={".html":"text/html; charset=utf-8",".css":"text/css",".js":"text/javascript",".mjs":"text/javascript",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".webmanifest":"application/manifest+json"};
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,"http://localhost").pathname;
  try{
    if(pathname==="/status.json"||pathname==="/history.json"||pathname==="/api-config.js"){
      const js=pathname.endsWith(".js");
      res.writeHead(200,{"Content-Type":js?mime[".js"]:mime[".json"]});
      return res.end(js?"window.PULSE_API_CONFIG={};":JSON.stringify(pathname==="/status.json"?sample:history));
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
const chrome=spawn("google-chrome",["--headless=new","--no-sandbox","--disable-dev-shm-usage","--disable-background-networking","--disable-gpu","--no-first-run","--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],{stdio:"ignore"});
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
  for(const [name,width,height] of [["desktop",1440,900],["mobile",390,844],["small-mobile",320,640]]){
    await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});
    await send("Page.navigate",{url:origin+"/#/"});
    await wait("document.querySelectorAll('.service-card').length===3");
    assert.match(await evalJS("document.title"),/Yandex Pulse/);
    assert.equal(await evalJS("document.documentElement.scrollWidth<=innerWidth"),true,"horizontal overflow "+name);
    const banner=await evalJS(`(()=>{
      const box=document.querySelector("#data-health"), dot=box.querySelector(".data-health-dot"),
        title=box.querySelector(".data-health-title"), detail=box.querySelector(".data-health-detail"),
        source=box.querySelector(".data-health-source");
      const b=box.getBoundingClientRect(),d=dot.getBoundingClientRect(),t=title.getBoundingClientRect(),
        p=detail.getBoundingClientRect(),s=source.getBoundingClientRect();
      return {dotText:dot.textContent,title:title.textContent,detail:detail.textContent,source:source.textContent,
        contained:[d,t,p,s].every(r=>r.left>=b.left&&r.right<=b.right&&r.top>=b.top&&r.bottom<=b.bottom),
        separate:d.right<=t.left&&t.bottom<=p.top&&(s.left>=p.right||s.top>=p.bottom)};
    })()`);
    assert.equal(banner.dotText,"","decorative dot must stay empty");
    assert.equal(banner.title,"Опубликованный снимок");
    assert.equal(banner.detail,"Последняя опубликованная проверка · не официальный статус Яндекса");
    assert.equal(banner.source,"GitHub Pages");
    assert.equal(banner.contained,true,"data health content outside banner "+name);
    assert.equal(banner.separate,true,"data health elements overlap "+name);
    await shot(name+"-overview");
    await click('[data-filter="down"]');
    await wait("document.querySelectorAll('.service-card').length===1");
    assert.equal(await evalJS("document.querySelector('[data-filter=down]').getAttribute('aria-pressed')"),"true");
    await evalJS("document.querySelector('#search').value='nonexistent';document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}))");
    await wait("!!document.querySelector('.reset-filters')");
    await click(".reset-filters");
    await wait("document.querySelectorAll('.service-card').length===3");
    await click(name!=="desktop"?'.mobile-tab[href="#/music"]':'.nav-item[href="#/music"]');
    await wait("document.querySelectorAll('.service-card').length===2");
    assert.equal(await evalJS("document.querySelector('#all-count').textContent"),"2");
    await click("#jump-to-checks");
    assert.equal(await evalJS("location.hash"),"#/music");
    await click('[data-check="music-ynison"]');
    await wait("!document.querySelector('#modal-backdrop').hidden");
    assert.equal(await evalJS("document.querySelector('.app-shell').inert"),true);
    await click('[data-range="168"]');
    assert.equal(await evalJS("document.querySelector('[data-range=\"168\"]').getAttribute('aria-pressed')"),"true");
    await shot(name+"-ynison");
    await evalJS("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await wait("document.querySelector('#modal-backdrop').hidden");
    assert.equal(await evalJS("document.querySelector('.app-shell').inert"),false);
    await click("#theme-toggle");
    assert.equal(await evalJS("['light','dark'].includes(document.documentElement.dataset.theme)"),true);
    console.log(name+": navigation, filters, search reset, modal, theme, viewport OK");
  }
  assert.deepEqual(errors,[],"browser errors");
}finally{
  ws?.close();
  chrome.kill();
  server.close();
  await sleep(300);
  await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
