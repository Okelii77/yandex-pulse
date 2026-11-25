import {test} from "node:test";
import assert from "node:assert/strict";
import {classifyState,confirmedState,validRedirectHost} from "./state-confirmation.mjs";
import {readFileSync} from "node:fs";
const cases=JSON.parse(readFileSync(new URL("./state-fixtures.json",import.meta.url),"utf8"));
for(const c of cases)test(c.name,()=>assert.equal(classifyState(c.frame),c.expected));
test("transport activity and parsed SDK defaults are not proof",()=>{
  assert.equal(confirmedState({receivedState:false,state:null,lastStateAgeMs:0}),false);
  assert.equal(confirmedState({receivedState:true,state:{playableList:[],paused:true}}),false);
});
test("redirect must be a Yandex DNS host over TLS 443",()=>{
  assert.equal(validRedirectHost("ynison.music.yandex.ru"),true);
  assert.equal(validRedirectHost("node.music.yandex.net:443"),true);
  for(const host of ["evil.test","yandex.ru.evil.test","foo.yandex.ru@evil.test","foo.yandex.net/path","foo.yandex.net:444","foo..yandex.ru","127.0.0.1"])assert.equal(validRedirectHost(host),false);
});
