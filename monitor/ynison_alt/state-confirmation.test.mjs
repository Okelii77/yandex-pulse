import {test} from "node:test";
import assert from "node:assert/strict";
import {confirmedState} from "./state-confirmation.mjs";

test("startup timestamp must not be interpreted as successful connection",()=>{
  assert.equal(confirmedState({receivedState:false,state:null,lastStateAgeMs:0}),false);
});
test("idle unconfirmed websocket is not a successful Ynison state",()=>{
  assert.equal(confirmedState({receivedState:false,state:{},lastStateAgeMs:1200}),false);
});
test("confirmed state event with frame confirms connection",()=>{
  assert.equal(confirmedState({receivedState:true,state:{playableList:[],paused:true}}),true);
});
test("event with missing state is not success",()=>{
  assert.equal(confirmedState({receivedState:true,state:null}),false);
});
