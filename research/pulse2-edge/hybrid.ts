import kernel from './kernel.wasm';
interface Row {v:number}
interface Env {DB:{prepare(sql:string):{all():Promise<{results:Row[]}>}}}
const instance=new WebAssembly.Instance(kernel as WebAssembly.Module);
const e=instance.exports as unknown as {memory:WebAssembly.Memory;buf():number;sum(n:number):number};
export default {async fetch(_request:Request,env:Env):Promise<Response>{const {results}=await env.DB.prepare("SELECT v FROM lab_values ORDER BY id").all();if(results.length>8192)throw Error('fixture limit');const b=new Uint32Array(e.memory.buffer,e.buf(),results.length);for(let i=0;i<results.length;i++)b[i]=results[i].v;return Response.json({count:results.length,sum:e.sum(results.length)});}};
