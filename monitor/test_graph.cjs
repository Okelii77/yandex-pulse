/** Verify chart remains readable with very little history and filters the range. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../site/app.js'), 'utf8');
const start = code.indexOf('  function plot('),end=code.indexOf('  function showChartPoint(',start);
assert.ok(start>=0&&end>start);
const plot = new Function('fmtDate','esc','STATES','window',code.slice(start,end)+'\nreturn plot;')(
    d => new Date(d).toISOString(),
    s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'),
    {ok:['Отвечает']},
    {matchMedia:()=>({matches:false})}
);
const now=Date.now();
const points=[[new Date(now-2*3600000).toISOString(),'ok',1250],
              [new Date(now-3600000).toISOString(),'ok',850]];
const d24=plot(points,24,30),d7=plot(points,168,30),d30=plot(points,720,30);
for (const p of [d24,d7,d30]){
  const coords=[...p.matchAll(/class="chart-dot ok" cx="([\d.]+)"/g)].map(m=>Number(m[1]));
  assert.equal(coords.length,2);
  assert.ok(coords[0]<25&&coords[1]>975,'Sparse data should span available width');
  assert.match(p,/Y · Время ответа, мс/);
  assert.match(p,/X · Проверки по времени/);
  assert.match(p,/chart-y-axis/);
  assert.match(p,/chart-x-axis/);
}
assert.notEqual(d24.match(/<div class="chart-x-axis">(.+?)<\/div>/)?.[1],
                d30.match(/<div class="chart-x-axis">(.+?)<\/div>/)?.[1],
                '24h tick labels use clock while 30d include date');
assert.match(plot([],168,30),/Данных пока нет/);
assert.match(plot([],168,30),/chart-x-axis/);
console.log('Charts OK: sparse points fill the viewport; axes, dates and empty state are present.');
