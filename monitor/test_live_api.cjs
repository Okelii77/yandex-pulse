const {test}=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const path=require("node:path");
const code=fs.readFileSync(path.join(__dirname,"../site/live-api.js"),"utf8");
function setup(){
  let revision="2026-11-25T10:00:00Z", fail=false;
  const calls=[];
  const window={PULSE_API_CONFIG:{apiUrl:"https://pulse.example"}};
  vm.runInNewContext(code,{window,AbortSignal,fetch:async url=>{
    const route=new URL(url).pathname;
    calls.push(route);
    return {ok:route!=="/api/history"||!fail,status:503,json:async()=>route==="/api/status"?{generated_at:revision,checks:[],results:[]}:{series:{}}};
  }});
  return {api:window.PulseLive,calls,setRevision(v){revision=v;},setFail(v){fail=v;}};
}
test("28 unchanged polls require only one history fetch",async()=>{
  const f=setup();
  for(let i=0;i<28;i++)await f.api.snapshot();
  assert.equal(f.calls.filter(x=>x==="/api/status").length,28);
  assert.equal(f.calls.filter(x=>x==="/api/history").length,1);
});
test("new status is delivered before history; history errors retain live status",async()=>{
  const f=setup();
  const initial=await f.api.snapshot();
  f.setRevision("2026-11-25T10:30:00Z");
  f.setFail(true);
  let called=false;
  const result=await f.api.snapshot(s=>{called=true;assert.equal(f.calls.at(-1),"/api/status");assert.equal(s.generated_at,"2026-11-25T10:30:00Z");});
  assert.equal(called,true);
  assert.equal(result.status.generated_at,"2026-11-25T10:30:00Z");
  assert.equal(result.history,initial.history);
  assert.equal(result.historyFresh,false);
  f.setFail(false);
  assert.equal((await f.api.snapshot()).historyFresh,true);
});
