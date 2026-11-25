import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import worker from "../src/index.mjs";

// An unbound worker must fail safely instead of returning fake green statuses.
test("unconfigured D1 reports 503", async()=>{
  const response=await worker.fetch(new Request("https://pulse.workers.dev/api/status"),{});
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,"database_not_bound");
});
test("cross-origin preflight is forbidden",async()=>{
  const response=await worker.fetch(new Request("https://pulse.workers.dev/api/trigger",{
    method:"OPTIONS",headers:{Origin:"https://evil.example"}
  }),{DB:{}});
  assert.equal(response.status,403);
});
test("inbound ingestion requires bearer secret",async()=>{
  const response=await worker.fetch(new Request("https://pulse.workers.dev/api/ingest",{
    method:"POST",headers:{"Content-Type":"application/json"},body:"{}"
  }),{DB:{},INGEST_TOKEN:"secret"});
  assert.equal(response.status,401);
});
test("manual trigger cannot run without configured secrets",async()=>{
  const response=await worker.fetch(new Request("https://pulse.workers.dev/api/trigger",{
    method:"POST",headers:{Origin:"https://okelii77.github.io","Content-Type":"application/json"},
    body:JSON.stringify({turnstileToken:"fake"})
  }),{DB:{}});
  assert.equal(response.status,503);
});
test("no OPTIONS cross-origin permissiveness",async()=>{
  const response=await worker.fetch(new Request("https://pulse.workers.dev/api/status",{
    method:"OPTIONS",headers:{Origin:"https://okelii77.github.io"}
  }),{DB:{}});
  assert.equal(response.status,204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"),"https://okelii77.github.io");
});

test("history cache isolates CORS, ignores user query and rotates on new revision", async()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,"caches");
  const store=new Map();
  Object.defineProperty(globalThis,"caches",{configurable:true,value:{default:{
    match:async k=>store.get(k.url)?.clone(),
    put:async(k,v)=>store.set(k.url,v.clone())
  }}});
  let revision="2026-11-25T10:00:00Z", scans=0;
  const env={DB:{prepare(sql){
    if(sql.includes("SELECT generated_at"))return {first:async()=>({generated_at:revision})};
    if(sql.includes("WITH ranked"))return {bind:()=>({all:async()=>{scans++;return {results:[]};}})};
    throw Error("unexpected query");
  }}};
  try{
    const one=await worker.fetch(new Request("https://pulse.workers.dev/api/history?random=1",{headers:{Origin:"https://okelii77.github.io"}}),env);
    assert.equal(one.headers.get("X-Pulse-Cache"),"MISS");
    assert.equal(one.headers.get("Access-Control-Allow-Origin"),"https://okelii77.github.io");
    const two=await worker.fetch(new Request("https://pulse.workers.dev/api/history?random=2",{headers:{Origin:"https://evil.example"}}),env);
    assert.equal(two.headers.get("X-Pulse-Cache"),"HIT");
    assert.equal(two.headers.get("Access-Control-Allow-Origin"),null);
    assert.equal(two.headers.get("Cache-Control"),"no-store");
    assert.equal(scans,1);
    revision="2026-11-25T10:30:00Z";
    const three=await worker.fetch(new Request("https://pulse.workers.dev/api/history"),env);
    assert.equal(three.headers.get("X-Pulse-Cache"),"MISS");
    assert.equal(scans,2);
  }finally{
    if(old)Object.defineProperty(globalThis,"caches",old);else delete globalThis.caches;
  }
});
test("status never uses history cache and always reads authoritative D1",async()=>{
  let reads=0;
  const env={DB:{prepare(sql){assert.match(sql,/SELECT payload FROM latest/);return {first:async()=>({payload:JSON.stringify({revision:++reads})})};}}};
  for(let i=1;i<=2;i++){
    const r=await worker.fetch(new Request("https://pulse.workers.dev/api/status"),env);
    assert.equal((await r.json()).revision,i);
    assert.equal(r.headers.get("Cache-Control"),"no-store");
  }
});
