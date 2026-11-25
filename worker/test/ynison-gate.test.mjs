import {test} from "node:test";
import assert from "node:assert/strict";
import {acquireYnison,finishYnison,nextBlockedUntil,legacyCooldown} from "../src/ynison-gate.mjs";
const now=Date.parse("2026-11-25T10:00:00Z");
const snapshot=(extra={})=>({generated_at:new Date(now).toISOString(),results:[{id:"music-ynison",status:"disabled",...extra}]});
function db(s=snapshot()){
  let gate=null;
  return {prepare(sql){
    if(sql.startsWith("SELECT payload"))return {first:async()=>({payload:JSON.stringify(s)})};
    if(sql.startsWith("INSERT"))return {bind:(lease,until,client,t)=>({first:async()=>{
      if(gate&&gate.blocked_until>t)return null;
      gate={lease_id:lease,blocked_until:until};return gate;
    }})};
    if(sql.startsWith("SELECT blocked_until"))return {first:async()=>gate};
    if(sql.startsWith("UPDATE"))return {bind:(until,outcome,finished,lease,t)=>({first:async()=>{
      if(!gate||gate.lease_id!==lease||gate.blocked_until<=t)return null;
      gate={lease_id:"",blocked_until:until};return gate;
    }})};
    throw Error("unknown SQL");
  }};
}
test("legacy pause and invalid state fail closed",async()=>{
  assert.equal((await acquireYnison(db(snapshot({retry_after_at:new Date(now+3600000).toISOString()})),{client:"python"},now)).status,429);
  assert.throws(()=>legacyCooldown(snapshot({retry_after_at:"broken"}),now));
  assert.throws(()=>legacyCooldown(snapshot({status:"cooldown"}),now));
});
test("one reservation across clients, crash cooldown, exact owner finalization",async()=>{
  const d=db();
  const [a,b]=await Promise.all([acquireYnison(d,{client:"python"},now),acquireYnison(d,{client:"javascript"},now)]);
  assert.deepEqual([a.status,b.status].sort(),[200,429]);
  const lease=(a.status===200?a:b).body.lease_id;
  assert.equal((await finishYnison(d,{lease_id:"00000000-0000-0000-0000-000000000000",outcome:"ok"},now)).status,409);
  const f=await finishYnison(d,{lease_id:lease,outcome:"error",retry_after_seconds:3600},now);
  assert.equal(Date.parse(f.body.retry_after_at),now+3615000);
  assert.equal((await acquireYnison(d,{client:"javascript"},now+1000)).status,429);
  assert.equal((await finishYnison(d,{lease_id:lease,outcome:"ok"},now)).status,409);
});
test("long go-away is not capped at sixty seconds; malformed input rejected",()=>{
  assert.equal(nextBlockedUntil({outcome:"error",retry_after_seconds:90000},now),now+90015000);
  assert.throws(()=>nextBlockedUntil({outcome:"ok",retry_after_seconds:-1},now));
});
