// Generates a staging-only config after a real database ID is provided; no cloud calls.
import fs from 'node:fs';import path from 'node:path';
const id=process.env.PULSE_RC_D1_ID,origin=process.env.PULSE_RC_ORIGIN;
if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id||'')||id.toLowerCase()==='f2ed0b6b-5483-453f-9298-129b8528547f')throw Error('dedicated staging D1 ID required');
if(!/^https:\/\/yandex-pulse-rc2\.[a-z0-9-]+\.workers\.dev$/.test(origin||''))throw Error('dedicated RC2 origin required');
const enabled=process.env.PULSE_RC_ENABLE_DISPATCH==='1';if(enabled&&process.env.PULSE_RC_QUOTA_APPROVED!=='1')throw Error('explicit free-quota approval required');
const assets='staging-assets';fs.mkdirSync(assets,{recursive:true});
for(const x of fs.readdirSync('../../site')){if(!/^[a-zA-Z0-9_.-]+$/.test(x)||/^(status\.json|history\.json|api-config\.js)$/.test(x))continue;const src=path.join('../../site',x);if(fs.statSync(src).isFile())fs.copyFileSync(src,path.join(assets,x));}
let html=fs.readFileSync(path.join(assets,'index.html'),'utf8');html=html.replace('<title>','<title>STAGING · ').replace(/<body([^>]*)>/,'<body$1><div role="status" style="padding:8px;text-align:center;background:#865710;color:white">Yandex Pulse 2.0 RC2 · STAGING · Экспериментальные данные</div>');fs.writeFileSync(path.join(assets,'index.html'),html);
const config={name:'yandex-pulse-rc2',main:'dist/worker.js',compatibility_date:'2026-10-15',workers_dev:true,assets:{directory:'./staging-assets',binding:'ASSETS',run_worker_first:true},d1_databases:[{binding:'DB',database_name:'yandex-pulse-rc2',database_id:id}],vars:{RC_ORIGIN:origin,RC_MODE:'synthetic',RC_ENABLE_DISPATCH:enabled?'1':'0'},triggers:{crons:enabled?['7,17,27,37,47,57 * * * *']:[]}};
fs.writeFileSync('wrangler.rc2.generated.json',JSON.stringify(config,null,2)+'\n');console.log('Staging config generated; dispatch '+(enabled?'enabled in config only':'disabled'));
