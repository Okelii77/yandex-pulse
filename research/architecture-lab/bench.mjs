import http from 'node:http';
import {performance} from 'node:perf_hooks';
const delay=Number(process.argv[2]), start=performance.now();
let active=0,count=0;const pending=[];
function pump(){while(active<8&&pending.length)pending.shift()()}
function call(){return new Promise((resolve,reject)=>{pending.push(()=>{active++;let settled=false;const done=e=>{if(settled)return;settled=true;active--;if(e)reject(e);else{count++;resolve(1)}pump()};const req=http.get(`http://127.0.0.1:18761/?delay=${delay}`,{agent:false},res=>{let s='';res.setEncoding('utf8');res.on('data',c=>s+=c);res.on('error',done);res.on('end',()=>{try{if(res.statusCode!==200||JSON.parse(s).ok!==true)throw Error('invalid response');done()}catch(e){done(e)}})});req.setTimeout(9000,()=>req.destroy(Error('timeout')));req.on('error',done)});pump()})}
const pub=Array.from({length:22},()=>call());await call();await Promise.all([...pub,call(),call()]);if(count!==25)throw Error('count');console.log(JSON.stringify({ms:performance.now()-start,requests:count}));
