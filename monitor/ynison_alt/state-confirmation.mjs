const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const field=(x,a,b)=>x?.[a]??x?.[b];
const integer=x=>typeof x==="number"&&Number.isSafeInteger(x)?x:typeof x==="string"&&/^-?\d+$/.test(x)&&Number.isSafeInteger(Number(x))?Number(x):null;
// Validate the raw server frame, before any SDK fills missing fields.
export function classifyState(frame){
  if(!object(frame)||Object.hasOwn(frame,"error"))return null;
  const p=field(frame,"player_state","playerState"), q=field(p,"player_queue","playerQueue"), s=p?.status;
  if(!object(p)||!object(q)||!object(s))return null;
  const paused=s.paused, duration=field(s,"duration_ms","durationMs"), progress=field(s,"progress_ms","progressMs");
  if(paused!==undefined&&typeof paused!=="boolean")return null;
  for(const n of [duration,progress])if(n!==undefined&&(integer(n)===null||integer(n)<0))return null;
  if(paused===undefined&&duration===undefined&&progress===undefined)return null;
  const list=field(q,"playable_list","playableList"), rawIndex=field(q,"current_playable_index","currentPlayableIndex");
  if(list!==undefined&&!Array.isArray(list))return null;
  const idx=rawIndex===undefined?0:integer(rawIndex);
  if(idx===null||idx< -1)return null;
  if(idx===-1)return "no_data";
  if(Array.isArray(list)&&list.length===0)return idx===0?"no_data":null;
  if(!Array.isArray(list)||idx>=list.length)return null;
  const id=field(list[idx],"playable_id","playableId");
  return typeof id==="string"&&id.trim()?"ok":null;
}
export function confirmedState({receivedState,state}){
  return receivedState===true&&classifyState(state)!==null;
}
export function validRedirectHost(host){
  return typeof host==="string"&&/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+yandex\.(?:ru|net)(?::443)?$/i.test(host);
}
