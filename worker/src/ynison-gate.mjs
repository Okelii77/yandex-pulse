// Fail closed if the previous authoritative snapshot or the gate is unavailable.
// A reservation also installs a conservative crash cooldown before any network dial.
const DAY=86400000, GRACE=15000, MIN_GAP=900000;
const clients=new Set(["python","javascript"]);
const outcomes=new Set(["ok","no_data","error","timeout","unknown"]);
const answer=(status,body)=>({status,body});
export function legacyCooldown(snapshot,now){
  if(!snapshot || !Number.isFinite(Date.parse(snapshot.generated_at)) ||
    Date.parse(snapshot.generated_at)>now+60000 || now-Date.parse(snapshot.generated_at)>DAY ||
    !Array.isArray(snapshot.results))throw Error("invalid_snapshot");
  const rows=snapshot.results.filter(x=>x?.id==="music-ynison");
  if(rows.length!==1)throw Error("invalid_snapshot");
  const value=rows[0].retry_after_at;
  if(value===undefined||value===null){
    if(rows[0].status==="cooldown")throw Error("unknown_cooldown");
    return 0;
  }
  const stamp=typeof value==="string"?Date.parse(value):NaN;
  if(!Number.isFinite(stamp))throw Error("unknown_cooldown");
  return stamp+GRACE;
}
export async function acquireYnison(db,body,now=Date.now()){
  if(!clients.has(body?.client))return answer(400,{error:"invalid_client"});
  const row=await db.prepare("SELECT payload FROM latest WHERE id=1").first();
  const until=legacyCooldown(row?JSON.parse(row.payload):null,now);
  if(until>now)return answer(429,{error:"cooldown",retry_after_at:new Date(until).toISOString()});
  const lease=crypto.randomUUID();
  const reserved=await db.prepare(
    "INSERT INTO ynison_gate(id,lease_id,blocked_until,client) VALUES(1,?,?,?) "+
    "ON CONFLICT(id) DO UPDATE SET lease_id=excluded.lease_id,blocked_until=excluded.blocked_until,client=excluded.client "+
    "WHERE ynison_gate.blocked_until<=? RETURNING lease_id"
  ).bind(lease,now+DAY,body.client,now).first();
  if(!reserved){
    const existing=await db.prepare("SELECT blocked_until FROM ynison_gate WHERE id=1").first();
    return answer(429,{error:"cooldown",retry_after_at:new Date(existing.blocked_until).toISOString()});
  }
  return answer(200,{ok:true,lease_id:lease});
}
export function nextBlockedUntil(body,now){
  if(!outcomes.has(body?.outcome))throw Error("invalid_outcome");
  const seconds=body.retry_after_seconds;
  if(seconds!==undefined && (!Number.isSafeInteger(seconds)||seconds<0||seconds>315360000))
    throw Error("invalid_retry");
  const minimum=body.outcome==="ok"||body.outcome==="no_data"?MIN_GAP:body.outcome==="unknown"?DAY:3600000;
  return now+Math.max(minimum,seconds?seconds*1000+GRACE:0);
}
export async function finishYnison(db,body,now=Date.now()){
  if(typeof body?.lease_id!=="string"||!/^[a-f0-9-]{36}$/.test(body.lease_id))
    return answer(400,{error:"invalid_lease"});
  let until;
  try{until=nextBlockedUntil(body,now);}catch{return answer(400,{error:"invalid_result"});}
  const row=await db.prepare(
    "UPDATE ynison_gate SET lease_id='',blocked_until=?,last_client=client,last_outcome=?,last_finished=?,client=NULL "+
    "WHERE id=1 AND lease_id=? AND blocked_until>? RETURNING blocked_until"
  ).bind(until,body.outcome,now,body.lease_id,now).first();
  if(!row)return answer(409,{error:"lease_not_owned"});
  return answer(200,{ok:true,retry_after_at:new Date(row.blocked_until).toISOString()});
}

export async function publicYnisonStatus(db,now=Date.now()){
  const row=await db.prepare("SELECT blocked_until,last_client,last_outcome,last_finished FROM ynison_gate WHERE id=1").first();
  const retry=Number.isSafeInteger(row?.blocked_until)&&row.blocked_until>now?new Date(row.blocked_until).toISOString():null;
  const last=clients.has(row?.last_client)&&outcomes.has(row?.last_outcome)&&Number.isSafeInteger(row?.last_finished)&&row.last_finished<=now?
    {client:row.last_client,outcome:row.last_outcome,checked_at:new Date(row.last_finished).toISOString()}:null;
  return {schema:1,automatic:false,last_diagnostic:last,retry_after_at:retry};
}
