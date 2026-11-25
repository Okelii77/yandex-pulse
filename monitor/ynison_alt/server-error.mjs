const number=value=>/^\d{1,10}$/.test(String(value))?Number(value):null;
function cooldown(result,values){
  for(const value of values){
    if(value===undefined||value===null)continue;
    const n=number(value);
    if(n===null||n>315360000){result.status="unknown";continue;}
    if(n>0)result.retry_after_seconds=Math.max(result.retry_after_seconds||0,n);
  }
  return result;
}
export function safeServerError(err){
  const details=err?.details??{}, extra=err?.extra_headers??{};
  const result={status:"error",stage:"server"};
  for(const [name,value] of [["http_code",err?.http_code],["grpc_code",err?.grpc_code],["error_code",details["ynison-error-code"]??extra["ynison-error-code"]]]){
    const n=number(value);if(n!==null)result[name]=n;
  }
  return cooldown(result,[details["ynison-go-away-for-seconds"],extra["ynison-go-away-for-seconds"]]);
}
export function safeHandshakeError(status,headers,stage){
  const result={status:"error",stage};
  const code=number(status);if(code!==null)result.http_code=code;
  const explicit=headers?.["ynison-go-away-for-seconds"], retry=headers?.["retry-after"];
  // HTTP Retry-After may be a date as well as delta-seconds.
  let parsed=retry;
  if(typeof retry==="string"&&!/^\d+$/.test(retry)){
    const date=Date.parse(retry);
    if(Number.isFinite(date))parsed=String(Math.max(0,Math.ceil((date-Date.now())/1000)));
  }
  return cooldown(result,[explicit,parsed]);
}
