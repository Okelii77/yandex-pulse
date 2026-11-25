const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const code=fs.readFileSync(path.join(__dirname,"../site/app.js"),"utf8");
const begin=code.indexOf("  function describeData("),end=code.indexOf("  function renderHero(",begin);
assert.ok(begin>=0&&end>begin);
const describe=new Function(code.slice(begin,end)+"\nreturn describeData;")();
const now=Date.parse("2026-11-25T12:00:00Z");
const snapshot={generated_at:"2026-11-25T11:55:00Z",interval_minutes:30};
test("live status never implies history or global health",()=>{
  const d=describe(snapshot,"live",now,false);
  assert.equal(d.kind,"ok");
  assert.match(d.detail,/история/);
  assert.equal(d.source,"Cloudflare D1");
});
test("archive and last known remain explicitly marked",()=>{
  for(const source of ["archive","last_known"]){
    const d=describe(snapshot,source,now,true);
    assert.equal(d.kind,"warning");
    assert.match(d.detail,/Live API недоступен/);
  }
});
test("stale, missing and static data are not called live",()=>{
  assert.equal(describe(null,"live",now,false).kind,"waiting");
  assert.equal(describe(snapshot,"live",now+7200000,true).kind,"warning");
  assert.equal(describe(snapshot,"legacy",now,true).kind,"neutral");
});
