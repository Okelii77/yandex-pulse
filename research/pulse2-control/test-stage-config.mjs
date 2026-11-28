import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import fs from 'node:fs';
const run=env=>spawnSync(process.execPath,['stage-config.mjs'],{env:{...process.env,...env},encoding:'utf8'});
const base={PULSE_RC_D1_ID:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',PULSE_RC_ORIGIN:'https://yandex-pulse-rc2.fixture.workers.dev',PULSE_RC_ENABLE_DISPATCH:'0'};
assert.equal(run(base).status,0);const c=JSON.parse(fs.readFileSync('wrangler.rc2.generated.json'));assert.equal(c.name,'yandex-pulse-rc2');assert.deepEqual(c.triggers.crons,[]);assert.equal(c.vars.RC_MODE,'synthetic');assert(!fs.existsSync('staging-assets/status.json'));assert(!fs.existsSync('staging-assets/history.json'));assert.match(fs.readFileSync('staging-assets/index.html','utf8'),/Экспериментальные данные/);
assert.notEqual(run({...base,PULSE_RC_D1_ID:'f2ed0b6b-5483-453f-9298-129b8528547f'}).status,0);assert.notEqual(run({...base,PULSE_RC_ENABLE_DISPATCH:'1',PULSE_RC_QUOTA_APPROVED:'0'}).status,0);assert.notEqual(run({...base,PULSE_RC_ORIGIN:'https://yandex-pulse-api.oleg-pulse-03.workers.dev'}).status,0);assert.notEqual(run({...base,PULSE_RC_ENABLE_DISPATCH:'1',PULSE_RC_QUOTA_APPROVED:'1'}).status,0);
const start=Math.ceil(Date.now()/1800000)*1800000;
assert.equal(run({...base,PULSE_RC_ENABLE_DISPATCH:'1',PULSE_RC_QUOTA_APPROVED:'1',PULSE_RC_PINNED_SHA:'b'.repeat(40),PULSE_RC_OBSERVE_START:String(start),PULSE_RC_OBSERVE_END:String(start+604800000)}).status,0);
const enabled=JSON.parse(fs.readFileSync('wrangler.rc2.generated.json'));assert.equal(enabled.vars.RC_MAX_LAUNCHES,'48');assert.deepEqual(enabled.triggers.crons,['2,13,32,43 * * * *']);
console.log('RC2 staging isolation and exact observation window checks passed');
