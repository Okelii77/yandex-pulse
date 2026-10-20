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
