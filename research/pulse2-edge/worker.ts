interface Row {v:number}
interface Env {DB:{prepare(sql:string):{all():Promise<{results:Row[]}>}}}
export default {async fetch(_request:Request,env:Env):Promise<Response>{const {results}=await env.DB.prepare("SELECT v FROM lab_values ORDER BY id").all();let sum=0;for(const r of results)sum+=r.v;return Response.json({count:results.length,sum});}};
