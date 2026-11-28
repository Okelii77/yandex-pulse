import {test} from 'node:test';import assert from 'node:assert/strict';import {plan,accept,SLOT} from './scheduler.mjs';
test('lease suppresses duplicates',()=>assert.equal(plan({now:SLOT*2,leaseUntil:SLOT*2+1}).reason,'lease'));
test('fresh data suppresses dispatch',()=>assert.equal(plan({now:SLOT*2+1,lastPublished:SLOT*2}).reason,'fresh'));
test('start is not publication',()=>assert.equal(plan({now:SLOT*2,lastStarted:SLOT,lastPublished:0}).action,'acquire'));
test('reject late and future samples',()=>{let a={id:'x',observedAt:100};assert.equal(accept(a,{id:'x',observedAt:99},200),a);assert.equal(accept(a,{id:'x',observedAt:100000},200),a);assert.equal(accept(a,{id:'x',observedAt:101},200).observedAt,101)});
