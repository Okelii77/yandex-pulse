import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeHar } from "../../site/ynison-har-core.mjs";

test("does not export any raw token, cookie, session, device ID or URL query",()=>{
  const secrets=["AUTH_SECRET_OAUTH","COOKIE_SECRET","TICKET_SECRET","DEVICE_PRIVATE_ABC","SESSION_PRIVATE","REQUEST_QUERY_PRIVATE"];
  const desc={"Ynison-Device-Id":secrets[3],"Ynison-Device-Info":JSON.stringify({app_name:"Chrome",type:"1",username:"USER_SECRET"}),
    "Ynison-Redirect-Ticket":secrets[2],"Ynison-Session-Id":secrets[4]};
  const har={log:{entries:[
    {request:{url:"wss://ynison.music.yandex.ru/ynison_state.YnisonStateService/PutYnisonState?uid="+secrets[5],headers:[
      {name:"Origin",value:"https://music.yandex.ru"},
      {name:"Authorization",value:"OAuth "+secrets[0]},
      {name:"Cookie",value:secrets[1]},
      {name:"Sec-WebSocket-Protocol",value:"Bearer, v2, "+encodeURIComponent(JSON.stringify(desc))}
    ]},response:{status:101}},
    {request:{url:"https://example.org/path?token="+secrets[0],headers:[{name:"Authorization",value:secrets[0]}]},response:{status:200}}
  ]}};
  const summary=summarizeHar(har);
  const serialized=JSON.stringify(summary);
  assert.equal(summary.matching_requests,1);
  assert.equal(summary.requests[0].stage,"state");
  assert.equal(summary.requests[0].origin,"https_music_yandex_ru");
  assert.equal(summary.requests[0].auth,"oauth-header");
  assert.equal(summary.requests[0].result_status,101);
  assert.equal(summary.requests[0].app_name_profile,"chrome");
  assert.equal(summary.requests[0].ticket_present,true);
  assert.equal(summary.requests[0].session_present,true);
  assert.equal(summary.requests[0].header_device_type,"1");
  for(const value of [...secrets,"USER_SECRET"])assert.equal(serialized.includes(value),false);
});
test("unknown fields cannot leak into report",()=>{
  const summary=summarizeHar({log:{entries:[{request:{
    url:"wss://ynison.music.yandex.ru/redirector.YnisonRedirectService/GetRedirectToYnison",
    headers:[{name:"Sec-WebSocket-Protocol",value:"Bearer, v2, %INVALID%"},
      {name:"Origin",value:"https://my.private.domain"},
      {name:"Authorization",value:"CustomToken SECRET"}]
  },response:{status:499}}]}});
  assert.equal(summary.matching_requests,1);
  assert.equal(summary.requests[0].origin,"different");
  assert.equal(summary.requests[0].result_status,"other_or_missing");
  assert.equal(summary.requests[0].device_info_present,false);
  assert.equal(JSON.stringify(summary).includes("my.private.domain"),false);
  assert.equal(JSON.stringify(summary).includes("SECRET"),false);
});
test("rejects invalid HAR and ignores unrelated hosts",()=>{
  assert.throws(()=>summarizeHar({}),/Это не HAR/);
  assert.equal(summarizeHar({log:{entries:[{request:{url:"https://invalid.example/ynison"}}]}}).matching_requests,0);
  assert.equal(summarizeHar({log:{entries:[{request:{url:"https://music.yandex.ru/favicon.ico"}}]}}).matching_requests,0);
});
