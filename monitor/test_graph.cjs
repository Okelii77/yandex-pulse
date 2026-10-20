/** Regression tests for time-window chart rendering, no external dependencies. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../site/app.js'), 'utf8');

const first = src.indexOf('  function plot(');
const last = src.indexOf('  function showChartPoint(', first);
assert.ok(first >= 0 && last > first, 'chart renderer must exist');
const renderChart = new Function(
  'fmtDate', 'esc', 'STATES', 'window',
  src.slice(first, last) + '\nreturn plot;'
)(
  date => new Date(date).toISOString(),
  str => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
  {ok: ['Отвечает']},
  {matchMedia: () => ({matches: false})}
);

const now = Date.now();
const points = [
  [new Date(now - 2 * 3600000).toISOString(), 'ok', 1250],
  [new Date(now - 3600000).toISOString(), 'ok', 850]
];
function firstX(html) {
  const match = html.match(/class="chart-dot ok" cx="([\d.]+)"/);
  assert.ok(match, 'measured point should be visible');
  return Number(match[1]);
}
const d24 = renderChart(points, 24, 30);
const d7 = renderChart(points, 168, 30);
const d30 = renderChart(points, 720, 30);

assert.ok(firstX(d24) < firstX(d7) && firstX(d7) < firstX(d30),
  'points must move toward the right edge when selecting a longer range');
for(const html of [d24,d7,d30]) {
  assert.match(html, /Y · Время ответа, мс/);
  assert.match(html, /X · Местное время/);
  assert.match(html, /chart-y-axis/);
  assert.match(html, /chart-x-axis/);
}
assert.notEqual(d24.match(/<div class="chart-x-axis">(.+?)<\/div>/)?.[1],
                d30.match(/<div class="chart-x-axis">(.+?)<\/div>/)?.[1],
                '24h and 30d tick labels must differ');
const empty = renderChart([], 168, 30);
assert.match(empty, /Данных пока нет/);
assert.match(empty, /chart-x-axis/);
console.log('Chart regression checks passed (24h, 7d, 30d, axes, empty state).');
