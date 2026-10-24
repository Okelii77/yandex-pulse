// Yandex Pulse local-only HAR inspector. No network calls, persistence or raw header output.
// Deliberately returns a strict whitelist of low-sensitivity protocol characteristics.
const DOMAIN="music.yandex.ru";
const MAX_ENTRIES=5000;
const LIMITED_STATUS=new Set([0,101,200,301,302,400,401,403,404,407,408,409,429,500,502,503,504]);
function hostIsYandexMusic(host){
  return host === DOMAIN || host.endsWith("."+DOMAIN);
}
function bool(v){return v===true;}
function headerMap(headers) {
  const h=new Map();
  if(Array.isArray(headers))for(const x of headers){
    if(typeof x?.name==="string" && typeof x?.value==="string" && x.name.length<100){
      const k=x.name.trim().toLowerCase();if(!h.has(k))h.set(k,x.value);
    }
  }
  return h;
}
function stage(url) {
  const path=url.pathname.toLowerCase();
  if(path.includes("redirector.ynisonredirectservice/getredirecttoynison"))return "redirector";
  if(path.includes("ynison_state.ynisonstateservice/putynisonstate"))return "state";
  return "other";
}
function classifyOrigin(value) {
  if (!value) return "absent";
  return value.toLowerCase().replace(/\/$/,"")==="https://music.yandex.ru"?"https_music_yandex_ru":"different";
}
function deviceFromProtocol(protocol) {
  const info={bearer_marker:false,protocol_v2:false,device_info_present:false,
    ticket_present:false,session_present:false,device_id_size_bucket:"unavailable",
    header_device_type:"unavailable",app_name_profile:"unavailable"};
  if(!protocol) return info;
  // The long encoded third subprotocol may contain secrets; never return raw text.
  const parts=protocol.split(/\s*,\s*/);
  info.bearer_marker=parts[0]?.toLowerCase()==="bearer";
  info.protocol_v2=parts[1]==="v2";
  if(parts.length<3) return info;
  let desc;
  try{
    const decoded=decodeURIComponent(parts.slice(2).join(","));
    if(decoded.length>5000) return info;
    desc=JSON.parse(decoded);
  }catch{return info;}
  if(!desc || typeof desc!=="object" || Array.isArray(desc))return info;
  info.device_info_present=Object.hasOwn(desc,"Ynison-Device-Info");
  info.ticket_present=Object.hasOwn(desc,"Ynison-Redirect-Ticket");
  info.session_present=Object.hasOwn(desc,"Ynison-Session-Id");
  const did=desc["Ynison-Device-Id"];
  if(typeof did==="string"){
    const n=did.length;
    info.device_id_size_bucket=n<=12?"1–12":n<=16?"13–16":n<=32?"17–32":"33+";
  }
  let di;
  try{di=JSON.parse(desc["Ynison-Device-Info"]);}catch{}
  if(di && typeof di==="object"){
    const t=String(di.type??"");
    info.header_device_type=["0","1","2","3","4"].includes(t)?t:"other";
    const n=di.app_name;
    info.app_name_profile=n==="Python SDK"?"python-sdk":n==="Node.js SDK"?"node-sdk":
      n==="Chrome"?"chrome":n==="YandexMusic .NET"?"dotnet-sdk":
      n==="ru.yandex.music"?"android-id":"other";
  }
  return info;
}
function authProfile(headers){
  const h=headers.get("authorization");
  if(h){
    if(/^oauth\s+\S+/i.test(h))return "oauth-header";
    if(/^bearer\s+\S+/i.test(h))return "bearer-header";
    return "other-header";
  }
  if(headers.has("cookie"))return "cookie-present";
  return "neither-header-nor-cookie";
}
function requestFamily(h,url){
  const upgrade=(h.get("upgrade")||"").toLowerCase();
  if(["ws:","wss:"].includes(url.protocol)||upgrade==="websocket"||
     h.has("sec-websocket-protocol"))return "websocket";
  return "http";
}
export function summarizeHar(har){
  const entries=har?.log?.entries;
  if(!Array.isArray(entries))throw Error("Это не HAR: отсутствует log.entries.");
  if(entries.length>MAX_ENTRIES)throw Error("HAR слишком большой по числу запросов.");
  const rows=[];
  for(const entry of entries){
    const req=entry?.request;
    if(!req||typeof req.url!=="string")continue;
    let url;
    try{url=new URL(req.url);}catch{continue;}
    if(!hostIsYandexMusic(url.hostname))continue;
    if(!url.hostname.includes("ynison") && !url.pathname.toLowerCase().includes("ynison"))continue;
    const h=headerMap(req.headers);
    const status=Number(entry?.response?.status);
    rows.push({
      stage:stage(url),
      transport:requestFamily(h,url),
      result_status:LIMITED_STATUS.has(status)?status:"other_or_missing",
      origin:classifyOrigin(h.get("origin")),
      auth:authProfile(h),
      cookie_header_present:bool(h.has("cookie")),
      websocket_protocol_header_present:bool(h.has("sec-websocket-protocol")),
      ...deviceFromProtocol(h.get("sec-websocket-protocol"))
    });
    if(rows.length>=30)break;
  }
  return {
    tool:"Yandex Pulse · Ynison HAR fingerprints",
    schema:1,
    matching_requests:rows.length,
    note:rows.length ? "Только безопасные характеристики handshake; значения токенов, cookies, device_id, ticket, session_id и URL не включены." :
      "Не найдены запросы Ynison. В DevTools включите Network → WS, обновите веб-плеер и экспортируйте HAR.",
    requests:rows
  };
}
