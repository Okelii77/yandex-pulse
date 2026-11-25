import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {acquireYnison,finishYnison} from "../src/ynison-gate.mjs";
test("real SQLite migration and reservation statements enforce a shared lease",async()=>{
  const sql=new DatabaseSync(":memory:");
  try{
    for(const file of ["0001_init.sql","0002_ynison_gate.sql"])
      sql.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
    const now=Date.parse("2026-11-25T10:00:00Z"),stamp=new Date(now).toISOString();
    sql.prepare("INSERT INTO latest VALUES(1,?,?)").run(stamp,JSON.stringify({generated_at:stamp,results:[{id:"music-ynison",status:"disabled"}]}));
    const db={prepare(query){
      const stmt=sql.prepare(query);
      return {first:async()=>stmt.get()??null,bind:(...args)=>({first:async()=>stmt.get(...args)??null})};
    }};
    const a=await acquireYnison(db,{client:"python"},now);
    assert.equal(a.status,200);
    assert.equal((await acquireYnison(db,{client:"javascript"},now)).status,429);
    const f=await finishYnison(db,{lease_id:a.body.lease_id,outcome:"error",retry_after_seconds:3600},now);
    assert.equal(Date.parse(f.body.retry_after_at),now+3615000);
    assert.equal((await acquireYnison(db,{client:"javascript"},now+3615000)).status,200);
  }finally{sql.close();}
});
