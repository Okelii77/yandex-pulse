// Local only: no external fetch, no cloud credentials.
export default {async fetch(_request,env){const {results}=await env.DB.prepare("SELECT v FROM lab_values ORDER BY id").all();let sum=0;for(const r of results)sum+=r.v;return Response.json({count:results.length,sum});}};
