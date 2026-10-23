import { Client } from "@dvxch/yandex-music";
import { appendFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { confirmedState } from "./state-confirmation.mjs";

// One-shot read-only diagnostic; no personal data or exception text is emitted.
const API = "https://yandex-pulse-api.oleg-pulse-03.workers.dev/api/status";
const startAt = Date.now();
const safeError = err => {
  const known=["Error","NetworkError","WebSocketError","UnauthorizedError","TimedOutError","TimeoutError","TypeError"];
  const e={type:known.includes(err?.name)?err.name:"OtherError"};
  for(const k of ["status","statusCode","httpCode","grpcCode","errorCode"]){
    if(Number.isInteger(err?.[k])&&err[k]>=0&&err[k]<1e10)e[k]=err[k];
  }
  return e;
};
async function cooldown(){
  const resp=await fetch(API,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(8000)});
  if(!resp.ok)throw Error("no status");
  const data=await resp.json();
  const stamp=Date.parse(data?.generated_at||"");
  if(!Number.isFinite(stamp)||Date.now()-stamp>2*3600e3)throw Error("stale");
  const row=data?.results?.find(x=>x.id==="music-ynison");
  if(!row)throw Error("no ynison probe");
  const until=Date.parse(row.retry_after_at||"");
  return Number.isFinite(until)&&until>Date.now()?new Date(until+15000).toISOString():null;
}
async function diagnose(){
  const token=process.env.YANDEX_MUSIC_TOKEN?.trim();
  if(!token)return {status:"not_configured",stage:"secret"};
  let until;
  try{until=await cooldown();}catch{return {status:"preflight_failed",stage:"cooldown",note:"Live cooldown was unavailable; no connection attempted"};}
  if(until)return {status:"cooldown",stage:"preflight",retry_after_at:until};
  let c;
  try{c=await new Client({token,retries:0}).init();}
  catch(e){return {status:"error",stage:"REST init",error:safeError(e)};}
  let rt;
  try{rt=c.realtime({staleTimeoutMs:120000,reconnect:false});}
  catch(e){return {status:"error",stage:"realtime init",error:safeError(e)};}
// Consider Ynison successful ONLY after an actual state frame.
// lastStateAgeMs is non-null when the transport *starts*, before any state.
// The previous test used this property and could falsely report success.
  let error=null;
  let receivedState=false;
  rt.on("state",()=>{receivedState=true;});
  rt.on("error",e=>{error??=safeError(e);});
  const running=Promise.resolve().then(()=>rt.start()).catch(e=>{error??=safeError(e);});
  try{
    const end=Date.now()+13000;
    while(Date.now()<end){
      if(confirmedState({receivedState,state:rt.state}))
        return {status:"ok",stage:"Ynison state"};
      if(error)return {status:"error",stage:"Ynison websocket",error};
      await delay(400);
    }
    return {status:"timeout",stage:"Ynison state"};
  }finally{
    try{rt.stop();}catch{}
    await Promise.race([running,delay(1200)]);
  }
}
let report;
try{report=await diagnose();}catch{report={status:"internal_error",stage:"diagnostic"};}
report={checked_at:new Date().toISOString(),client:"@dvxch/yandex-music",
  duration_ms:Date.now()-startAt,...report};
await writeFile("ynison-diagnostic.json",JSON.stringify(report,null,2)+"\n");
const lines=["## Ynison · независимый JS-клиент",
  "","**Статус:** "+report.status,
  "","| Поле | Результат |","| --- | --- |",
  "| Время UTC | "+report.checked_at+" |",
  "| Этап | "+report.stage+" |",
  "| Длительность | "+report.duration_ms+" мс |"];
if(report.error)lines.push("| Тип ошибки | "+report.error.type+" |");
if(report.retry_after_at)lines.push("| Не раньше UTC | "+report.retry_after_at+" |");
lines.push("","Тест не отправляет команды воспроизведения и не публикует треки, токены или данные аккаунта.","");
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,lines.join("\n"));
console.log("Independent Ynison diagnostic:",report.status,"stage:",report.stage);
