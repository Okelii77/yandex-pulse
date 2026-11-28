// Deterministic single-module RC2 deployment for the API connector (no asset JWT upload).
// Compile TS first using locked TypeScript. Do not embed production status/history/config.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=path.resolve('../..'),site=path.join(root,'site');
const files={};
const mime={html:'text/html;charset=UTF-8',js:'text/javascript;charset=UTF-8',mjs:'text/javascript;charset=UTF-8',css:'text/css;charset=UTF-8',svg:'image/svg+xml',webmanifest:'application/manifest+json',png:'image/png'};
for(const name of fs.readdirSync(site).sort()){
 const ext=name.split('.').at(-1);if(!Object.hasOwn(mime,ext)||['status.json','history.json','api-config.js'].includes(name)||!fs.statSync(path.join(site,name)).isFile())continue;
 let data=fs.readFileSync(path.join(site,name));
 if(ext==='png'){if(!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('invalid PNG '+name);files[name]={mime:mime[ext],base64:data.toString('base64')};continue;}
 let content=data.toString('utf8');
 if(name==='index.html')content=content.replace('<title>','<title>STAGING · ').replace('<body>','<body><div role="status" style="position:sticky;top:0;z-index:9999;padding:10px;text-align:center;background:#865710;color:white">Yandex Pulse 2.0 RC2 · STAGING · Только синтетические данные, не статус Яндекса</div>').replaceAll('/actions/workflows/pulse.yml','/actions/workflows/pulse2-rc-dispatch.yml').replace('VERSION 1.0.0','VERSION 2.0 RC2').replace('Обновление каждые ~30 минут','Расписание staging отключено');
 if(name==='manifest.webmanifest')content=JSON.stringify({...JSON.parse(content),name:'Yandex Pulse RC2 STAGING',short_name:'Pulse RC2'});
 if(name==='live-api.js')content=content.replace('GitHub Actions проверит сервисы, а результаты появятся здесь','GitHub Actions сформирует синтетические данные, а результаты появятся здесь');
 if(name==='ynison-audit.html')content=content.replace('<body>','<body><div role="status">STAGING · Локальный анализ; реальная диагностика отключена</div>');
 files[name]={mime:mime[ext],text:content};
}
for(const required of ['index.html','app.js','styles.css','live-api.js','favicon-32-v2.png','apple-touch-icon-v2.png','icon-192-v2.png','icon-512-v2.png','icon-v2.svg'])if(!files[required])throw Error('missing asset '+required);
const staticCode='const RC_STATIC='+JSON.stringify(files)+';\n'+`function rcStatic(path){const name=path==='/'?'index.html':path==='/favicon.ico'?'favicon-32-v2.png':path.slice(1);if(!Object.hasOwn(RC_STATIC,name))return new Response('Not found',{status:404});const asset=RC_STATIC[name];const body=asset.base64?Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0)):asset.text;return new Response(body,{headers:{'Content-Type':asset.mime,'Cache-Control':name.endsWith('.png')||name.endsWith('.svg')?'public, max-age=3600':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}});}\n`;
let worker=fs.readFileSync('dist/worker.js','utf8');
const pattern=/if \(req\.method === "GET" && !path\.startsWith\("\/api\/"\) && env\.ASSETS\)\s*return env\.ASSETS\.fetch\(req\);/;
if(!pattern.test(worker))throw Error('compiled asset route not found');
worker=worker.replace(pattern,'if (req.method === "GET" && !path.startsWith("/api/")) return rcStatic(path);');
const dest=path.join(root,'research/results/pulse2/rc2-cloud-bundle');fs.mkdirSync(dest,{recursive:true});const out=staticCode+worker;fs.writeFileSync(path.join(dest,'worker.js'),out);
const evidence={sha256:crypto.createHash('sha256').update(out).digest('hex'),bytes:Buffer.byteLength(out),assets:Object.keys(files),source:process.env.GITHUB_SHA||null};fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify(evidence,null,2)+'\n');console.log('RC2_BUNDLE',JSON.stringify(evidence));
