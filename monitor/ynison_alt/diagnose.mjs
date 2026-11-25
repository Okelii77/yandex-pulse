import {appendFile,writeFile} from "node:fs/promises";
import {randomUUID,createHmac} from "node:crypto";
import WebSocket from "ws";
import {classifyState,validRedirectHost} from "./state-confirmation.mjs";
import {safeServerError,safeHandshakeError} from "./server-error.mjs";
const API="https://yandex-pulse-api.oleg-pulse-03.workers.dev";
const started=Date.now();
async function gate(path,body){
  const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set("audience","yandex-pulse-ynison");
  const oidc=await fetch(url,{headers:{Authorization:"Bearer "+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},signal:AbortSignal.timeout(8000)});
  if(!oidc.ok)throw Error("oidc");
  const {value}=await oidc.json();
  if(typeof value!=="string"||!value)throw Error("oidc");
  const resp=await fetch(API+"/api/ynison/"+path,{method:"POST",headers:{Authorization:"Bearer "+value,"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
  return {code:resp.status,body:await resp.json()};
}
function exchange(url,token,protocol,hello,accept,stage){
  return new Promise(resolve=>{
    let ws,timer,done=false;
    const finish=result=>{
      if(done)return;
      done=true;clearTimeout(timer);
      try{ws?.terminate();}catch{}
      resolve(result);
    };
    try{
      ws=new WebSocket(url,["Bearer","v2",encodeURIComponent(JSON.stringify(protocol))],{
        headers:{Origin:"https://music.yandex.ru",Authorization:"OAuth "+token},
        followRedirects:false,handshakeTimeout:8000,maxPayload:8*1024*1024
      });
      timer=setTimeout(()=>finish({status:"timeout",stage}),12000);
      ws.on("open",()=>{if(hello)try{ws.send(JSON.stringify(hello));}catch{finish({status:"unknown",stage});}});
      ws.on("unexpected-response",(_req,res)=>{res.destroy();finish(safeHandshakeError(res.statusCode,res.headers,stage));});
      ws.on("error",()=>finish({status:"unknown",stage}));
      ws.on("close",()=>finish({status:"error",stage}));
      ws.on("message",(raw,binary)=>{
        if(binary||done)return;
        let frame;
        try{frame=JSON.parse(raw.toString());}catch{return;}
        if(frame?.error){finish(safeServerError(frame.error));return;}
        const accepted=accept(frame);
        if(accepted)finish(accepted);
      });
    }catch{finish({status:"unknown",stage});}
  });
}
async function probe(token){
  // Isolated controller identity; never sends a playback, queue edit or claim command.
  const id=createHmac("sha256",token).update("yandex-pulse-js-observer-v1").digest("hex").slice(0,16);
  const protocol={"Ynison-Device-Id":id,"Ynison-Device-Info":JSON.stringify({app_name:"Yandex Pulse",type:"1"})};
  const redirect=await exchange("wss://ynison.music.yandex.ru/redirector.YnisonRedirectService/GetRedirectToYnison",token,protocol,null,f=>{
    const ticket=f?.redirect_ticket??f?.redirectTicket, session=f?.session_id??f?.sessionId;
    if(!validRedirectHost(f?.host)||typeof ticket!=="string"||!ticket||!/^\d+$/.test(String(session)))return {status:"error",stage:"invalid_redirect"};
    return {host:f.host,ticket,session:String(session)};
  },"redirector");
  if(redirect.status)return redirect;
  protocol["Ynison-Redirect-Ticket"]=redirect.ticket;
  protocol["Ynison-Session-Id"]=redirect.session;
  const version={deviceId:id};
  const hello={rid:randomUUID(),updateFullState:{
    playerState:{status:{paused:true,playbackSpeed:1,version},playerQueue:{entityType:"VARIOUS",currentPlayableIndex:-1,options:{repeatMode:"NONE"},version,fromOptional:""}},
    device:{info:{deviceId:id,title:"Yandex Pulse",type:"WEB",appName:"Yandex Pulse"},capabilities:{canBeRemoteController:true},volumeInfo:{}}
  }};
  return exchange("wss://"+redirect.host+"/ynison_state.YnisonStateService/PutYnisonState",token,protocol,hello,f=>{
    const status=classifyState(f);
    return status?{status,stage:"validated_raw_state"}:null;
  },"state");
}
async function run(){
  const token=process.env.YANDEX_MUSIC_TOKEN?.trim();
  if(!token)return {status:"not_configured",stage:"secret"};
  let lease;
  try{lease=await gate("acquire",{client:"javascript"});}catch{return {status:"preflight_failed",stage:"gate"};}
  if(lease.code===429)return {status:"cooldown",stage:"gate",retry_after_at:lease.body.retry_after_at};
  if(lease.code!==200||lease.body.ok!==true||typeof lease.body.lease_id!=="string")return {status:"preflight_failed",stage:"gate"};
  let result;
  try{result=await probe(token);}catch{result={status:"unknown",stage:"diagnostic"};}
  try{
    const completed=await gate("finish",{lease_id:lease.body.lease_id,outcome:result.status,retry_after_seconds:result.retry_after_seconds});
    if(completed.code!==200||completed.body.ok!==true)throw Error("finish");
    result.retry_after_at=completed.body.retry_after_at;
    result.gate="recorded";
  }catch{result.gate="finish_failed_crash_cooldown";}
  return result;
}
let result;
try{result=await run();}catch{result={status:"unknown",stage:"diagnostic"};}
const report={checked_at:new Date().toISOString(),client:"pulse-js-wire",transport:"ws@8.18.3",duration_ms:Date.now()-started,...result};
await writeFile("ynison-diagnostic.json",JSON.stringify(report,null,2)+"\n");
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,"## Ynison JS wire diagnostic\n\nStatus: "+report.status+"; stage: "+report.stage+"; gate: "+(report.gate??"not_acquired")+"\n");
console.log("Ynison diagnostic:",report.status,report.stage);
if(report.gate==="finish_failed_crash_cooldown"||report.status==="preflight_failed")process.exitCode=1;
