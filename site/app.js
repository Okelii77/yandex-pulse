/* Yandex Pulse · accessible, dependency-free monitor UI. */
(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STATES = {
    ok: ["Отвечает", "Проверяемая точка входа отвечает"],
    down: ["Ошибка", "Проба завершилась ошибкой; общий сбой не подтверждён"],
    degraded: ["Ограничено", "Сервер ответил, но работоспособность функции не подтверждена"],
    no_data: ["Нет данных", "API ответил без подходящих данных"],
    not_configured: ["Не настроено", "Для проверки требуются дополнительные права или токен"],
    cooldown: ["Пауза", "Сервер запросил паузу до следующей проверки"],
    unknown: ["Неизвестно", "Статус нельзя определить"],
  };
  const PATHS = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    cloud: '<path d="M20 17.6A5 5 0 0 0 18 8a6.5 6.5 0 0 0-12.5 2A4 4 0 0 0 7 18h12"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m3 6 9 8 9-8"/>',
    "hard-drive": '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 13h20"/><circle cx="6.5" cy="16.5" r=".9"/><circle cx="10.5" cy="16.5" r=".9"/>',
    shield: '<path d="m12 2 9 4v6c0 5-3.4 8.4-9 10-5.6-1.6-9-5-9-10V6z"/><path d="m9 12 2 2 4-4"/>',
    "book-open": '<path d="M12 6c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V5c-4-1-7-1-10 1z"/><path d="M12 6v15"/>',
    "map-pin": '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    search: '<circle cx="10.8" cy="10.8" r="7.2"/><path d="m16 16 5.5 5.5"/>',
    sparkles: '<path d="m12 2 2.6 6.7L21 11l-6.4 2.3L12 20l-2.6-6.7L3 11l6.4-2.3z"/><path d="m19 19 1 2 1-2 2-1-2-1-1-2-2 1z"/>',
    layers: '<path d="m12 2 10 6-10 6L2 8z"/><path d="m2 12 10 6 10-6M2 16l10 6 10-6"/>'
  };
  const FALLBACK_CATEGORIES = [
    ["music","Музыка","music"],["cloud","Облако","cloud"],["mail","Почта","mail"],
    ["disk","Диск","hard-drive"],["identity","Яндекс ID","shield"],["wiki","Вики","book-open"],
    ["maps","Карты","map-pin"],["search","Поиск","search"],["ai","AI и SpeechKit","sparkles"],
    ["other","Другие сервисы","layers"]
  ].map(([id,title,icon]) => ({id,title,icon,description:"Проверки сервиса"}));

  const state = {data:null, history:null, category:"overview", filter:"all", query:"", modal:null, range:24, loading:false};
  const icon = key => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (PATHS[key] || PATHS.layers) + '</svg>';
  const esc = x => String(x == null ? "" : x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const cats = () => state.data?.categories || FALLBACK_CATEGORIES;
  const checks = () => state.data?.checks || [];
  const results = () => new Map((state.data?.results || []).map(x => [x.id, x]));
  const cat = key => cats().find(c => c.id === key);
  const fmtDate = (x,short=false) => {
    if (!x || Number.isNaN(new Date(x).getTime())) return "—";
    return new Intl.DateTimeFormat("ru-RU", short ?
      {day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"} :
      {day:"2-digit",month:"long",hour:"2-digit",minute:"2-digit"}).format(new Date(x));
  };
  const fmtMs = x => Number.isFinite(x) ? x + " мс" : "—";
  const age = x => {
    if (!x || Number.isNaN(new Date(x).getTime())) return "нет данных";
    const mins = Math.max(0, Math.floor((Date.now() - new Date(x))/60000));
    return mins < 1 ? "только что" : mins < 60 ? mins + " мин назад" : Math.floor(mins/60) + " ч назад";
  };
  const stale = () => !state.data?.generated_at ||
    Date.now()-new Date(state.data.generated_at).getTime() > Math.max(90, (state.data.interval_minutes || 30)*2.5)*60000;
  const hist = (id,hours=24) => (state.history?.series?.[id] || [])
    .filter(p => Array.isArray(p) && p.length >= 3 && Number.isFinite(new Date(p[0]).getTime()) &&
      new Date(p[0]).getTime() >= Date.now()-hours*3600000);
  const badge = name => '<span class="badge ' + esc(name) + '"><span class="badge-dot"></span>' +
    esc((STATES[name] || STATES.unknown)[0]) + '</span>';
  const nav = (id,title,ico,num) =>
    '<a href="#/' + esc(id === "overview" ? "" : id) + '" class="nav-item' + (state.category===id ? " active" : "") + '">' +
      '<span class="nav-icon">' + icon(ico) + '</span><span>' + esc(title) + '</span>' +
      (num ? '<span class="nav-count">' + num + '</span>' : "") + '</a>';

  function renderNavigation() {
    $("#side-nav").innerHTML = nav("overview","Общий обзор","overview") +
      '<div class="nav-group-title">ЭКОСИСТЕМА</div>' +
      cats().map(c=>nav(c.id,c.title,c.icon,checks().filter(x=>x.category===c.id).length)).join("");
    $("#mobile-categories").innerHTML = '<a href="#/" class="mobile-tab' + (state.category==="overview"?" active":"") + '">Обзор</a>' +
      cats().map(c=>'<a href="#/'+esc(c.id)+'" class="mobile-tab'+(state.category===c.id?" active":"")+'">'+esc(c.title)+'</a>').join("");
  }
  function renderHero() {
    const current = cat(state.category);
    $("#breadcrumb").textContent = current ? current.title.toUpperCase() : "ОБЗОР";
    $("#section-title").innerHTML = current ? esc(current.title)+'<span class="heading-dot">.</span>' : 'Сервисы и проверки<span class="heading-dot">.</span>';
    $("#section-desc").textContent = current ? current.description : "Сводка технической доступности по категориям";
    $("#hero-title").innerHTML = current ? esc(current.title)+'<br><em>под наблюдением.</em>' : 'Пульс цифровой<br><em>экосистемы.</em>';
    $("#hero-subtitle").textContent = current
      ? 'Сервисные проверки категории «'+current.title+'». Ответы, ошибки и история измерений из GitHub Actions.'
      : 'Сервисы, API и инфраструктура Яндекса в одном месте. Проверяем доступность, измеряем отклик и показываем историю.';
    $("#category-intro").hidden = !current;
    if (current) $("#category-intro").innerHTML = '<div><b>'+esc(current.title)+'</b><p>'+esc(current.description)+'</p></div><strong>'+checks().filter(x=>x.category===current.id).length+' проверок</strong>';
    $("#last-updated").textContent = state.data?.generated_at ? 'Проверено: '+fmtDate(state.data.generated_at) : 'Данных о последней проверке пока нет';
    const check = $("#topbar-check"), dot = $(".status-ping",check);
    if (!state.data) {
      check.lastChild.textContent = " Ожидание данных";
      dot.className = "status-ping";
    } else if (stale()) {
      check.lastChild.textContent = " Данные устарели";
      dot.className = "status-ping is-error";
    } else {
      check.lastChild.textContent = " Обновлено "+age(state.data.generated_at);
      dot.className = "status-ping is-ok";
    }
  }
  function renderStats() {
    const arr = state.data?.results || [];
    const vals = arr.map(x=>x.latency_ms).filter(Number.isFinite);
    const mean = vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
    const value = [arr.length || "—", arr.filter(x=>x.status==="ok").length, arr.filter(x=>x.status==="down").length, mean == null ? "—" : mean];
    $$(".metric-value").forEach((x,i)=>x.textContent = arr.length ? value[i] : "—");
    const others = arr.filter(x=>!["ok","down"].includes(x.status)).length;
    $$(".metric-footer")[0].textContent = others ? others+' требуют уточнения статуса' : 'В конфигурации';
    $("#all-count").textContent = arr.length || "—";
  }
  function bars(id) {
    const recent = hist(id).slice(-20);
    return '<div class="mini-bars" aria-label="Последние 20 проверок">' +
      Array.from({length:Math.max(0,20-recent.length)},()=>'<span class="mini-bar" title="Нет данных"></span>').join("") +
      recent.map(p=>'<span class="mini-bar '+esc(p[1])+'" title="'+esc(fmtDate(p[0]))+'"></span>').join("")+'</div>';
  }
  function serviceCard(check,row) {
    const status = row?.status || "unknown";
    return '<button type="button" class="service-card" data-check="'+esc(check.id)+'" aria-label="Подробнее: '+esc(check.name)+'">' +
      '<span class="service-icon">'+icon(cat(check.category)?.icon)+'</span>' +
      '<span class="service-desc"><span class="service-name">'+esc(check.name)+'</span><span class="service-sub">'+esc(check.detail)+'</span>' +
      (state.category==="overview"?'<span class="service-category">'+esc(cat(check.category)?.title || "")+'</span>':"") +
      '</span><span class="service-right">'+bars(check.id)+'<span class="mini-latency">'+fmtMs(row?.latency_ms)+'</span>'+
      badge(status)+'<span class="card-arrow" aria-hidden="true">›</span></span></button>';
  }
  function renderChecks() {
    const rowMap = results();
    const chosen = checks().filter(c=>
      (state.category==="overview" || c.category===state.category) &&
      (state.filter==="all" || (state.filter==="other" ? !["ok","down"].includes(rowMap.get(c.id)?.status) : state.filter===rowMap.get(c.id)?.status)) &&
      (c.name+" "+c.detail+" "+(cat(c.category)?.title||"")).toLocaleLowerCase("ru-RU").includes(state.query.toLocaleLowerCase("ru-RU"))
    );
    if (!state.data) {
      $("#service-list").innerHTML = '<div class="empty-state">Ожидаем первую публикацию проверок GitHub Actions.<br>После запуска здесь появятся реальные статусы.</div>';
      return;
    }
    if (!chosen.length) {
      $("#service-list").innerHTML = '<div class="empty-state">Ничего не найдено. Измени фильтр или поисковый запрос.</div>';
      return;
    }
    if (state.category!=="overview") {
      $("#service-list").innerHTML = chosen.map(x=>serviceCard(x,rowMap.get(x.id))).join("");
      return;
    }
    $("#service-list").innerHTML = cats().map(c=>{
      const group = chosen.filter(x=>x.category===c.id);
      return group.length ?
        '<div class="group-label" style="margin:18px 0 10px;font-size:10px;letter-spacing:1.3px;font-weight:850;color:var(--subtle);display:flex;justify-content:space-between">'+
        esc(c.title.toUpperCase())+' <span>'+group.length+' / '+checks().filter(x=>x.category===c.id).length+'</span></div>'+
        group.map(x=>serviceCard(x,rowMap.get(x.id))).join("") : "";
    }).join("");
  }
  function renderHistorySummary() {
    const cutoff=Date.now()-86400000;
    const recent=Object.values(state.history?.series||{}).flat().filter(p=>Array.isArray(p)&&new Date(p[0]).getTime()>=cutoff);
    const comparable=recent.filter(p=>["ok","degraded","down","no_data"].includes(p[1]));
    const success=comparable.filter(p=>p[1]==="ok").length;
    const percent=comparable.length?Math.round(success/comparable.length*100):null;
    const histogram=Array.from({length:36},(_,i)=>{
      const begin=cutoff+i*86400000/36, end=begin+86400000/36;
      const bucket=comparable.filter(p=>{const t=new Date(p[0]).getTime();return t>=begin && t<end});
      const st=!bucket.length?"":bucket.some(p=>p[1]==="down")?"down":bucket.some(p=>p[1]!=="ok")?"degraded":"ok";
      return '<span class="'+st+'" title="'+(bucket.length?bucket.length+" измерений":"Нет измерений")+'"></span>';
    }).join("");
    $("#activity-summary").innerHTML='<div class="summary-number">'+(percent ?? "—")+'<small>'+(percent===null?"":"%")+'</small></div>'+
      '<div class="summary-caption">'+(comparable.length?success+' из '+comparable.length+' успешных проб':'Пока нет измерений за 24 часа')+'</div>'+
      '<div class="availability-bars">'+histogram+'</div>';
    const events=[];
    for (const chk of checks()) {
      const points=state.history?.series?.[chk.id]||[];
      for (let i=1;i<points.length;i++) {
        if (points[i][1]!==points[i-1][1]) events.push({name:chk.name,time:points[i][0],status:points[i][1]});
      }
    }
    events.sort((a,b)=>new Date(b.time)-new Date(a.time));
    $("#events-list").innerHTML=events.length?events.slice(0,6).map(x=>
      '<div class="event"><span class="event-dot '+esc(x.status)+'"></span><div><b>'+esc(x.name)+' · '+esc(STATES[x.status]?.[0]||x.status)+
      '</b><small>'+esc(fmtDate(x.time,true))+'</small></div></div>').join("") :
      '<div class="empty-mini">Изменений статусов пока не зафиксировано.</div>';
  }
  function render() {
    renderNavigation();renderHero();renderStats();renderChecks();renderHistorySummary();
    $("#footer-time").textContent="Все времена — в часовом поясе устройства";
  }

  // Render against real timestamps. The X axis ALWAYS spans the selected
  // 24h / 7d / 30d window, even if observations exist for just one hour.
  function plot(points, hours, intervalMinutes=30) {
    const end=Date.now(),start=end-hours*3600000;
    const measured=points.filter(p=>Number.isFinite(p[2])&&Number.isFinite(new Date(p[0]).getTime()))
      .map(p=>({t:new Date(p[0]).getTime(),value:p[2],state:p[1],date:p[0]}))
      .filter(p=>p.t>=start&&p.t<=end).sort((a,b)=>a.t-b.t);
    const vals=measured.map(p=>p.value);
    const peak=Math.max(100,...vals);
    const scale=Math.pow(10,Math.floor(Math.log10(peak/3)));
    const normalized=peak/3/scale;
    const tickStep=(normalized<=1?1:normalized<=2?2:normalized<=5?5:10)*scale;
    const ceiling=Math.ceil(peak/tickStep)*tickStep;
    const ticksY=[ceiling,ceiling*.75,ceiling*.5,ceiling*.25,0];
    const W=1000,H=180;
    const dx=p=>(p.t-start)/(end-start)*W;
    const dy=p=>H-p.value/ceiling*H;
    const lines=[];
    const lineGaps=Math.max(75,intervalMinutes*2.5)*60000;
    let segment=[];
    const makeLine=()=>{
      if (!segment.length) return;
      const path=segment.map((p,i)=>(i?'L':'M')+dx(p).toFixed(3)+' '+dy(p).toFixed(3)).join(' ');
      const first=segment[0], last=segment[segment.length-1];
      const area=path+' L'+dx(last).toFixed(3)+' '+H+' L'+dx(first).toFixed(3)+' '+H+' Z';
      lines.push('<path d="'+area+'" fill="url(#pulse-chart-fill)"/>'+
        '<path d="'+path+'" stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke" fill="none" stroke-linecap="round" stroke-linejoin="round"/>');
      segment=[];
    };
    for (const point of measured){
      if(segment.length&&point.t-segment[segment.length-1].t>lineGaps)makeLine();
      segment.push(point);
    }
    makeLine();
    const grid=[0,.25,.5,.75,1].map(f=>{
      const y=(f*H).toFixed(1);
      return '<line x1="0" x2="'+W+'" y1="'+y+'" y2="'+y+
        '" stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="4 6"/>';
    }).join('');
    const pointsSvg=measured.map((p,i)=>
      '<circle class="chart-dot '+esc(p.state)+'" cx="'+dx(p).toFixed(3)+'" cy="'+dy(p).toFixed(3)+
      '" r="5" vector-effect="non-scaling-stroke" data-datapoint="'+i+'"><title>'+
      esc(fmtDate(p.date))+' — '+Math.round(p.value)+' мс ('+esc(STATES[p.state]?.[0]||p.state)+')</title></circle>').join('');
    const numberOfXTicks=window.matchMedia('(max-width: 480px)').matches?4:6;
    const xLabels=Array.from({length:numberOfXTicks+1},(_,i)=>{
      const time=new Date(start+(end-start)*i/numberOfXTicks);
      return '<span>'+esc(new Intl.DateTimeFormat("ru-RU",hours===24?
        {hour:"2-digit",minute:"2-digit"}:{day:"2-digit",month:"short"}).format(time))+'</span>';
    }).join('');
    const readout=measured.length?
      'Последний замер: '+fmtDate(measured[measured.length-1].date)+' · '+Math.round(measured[measured.length-1].value)+' мс'
      : 'Нет измерений времени ответа в этом периоде';
    return '<div class="chart-header"><span>Y · Время ответа, мс</span><span>X · Местное время</span></div>'+
      '<div class="chart-plot-layout">'+
      '<div class="chart-y-axis" aria-hidden="true">'+ticksY.map(n=>'<span>'+esc(Math.round(n).toLocaleString("ru-RU"))+'</span>').join('')+'</div>'+
      '<div class="chart-plot" data-start="'+start+'" data-end="'+end+'" data-span="'+W+'">'+
      '<svg class="chart-svg" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="Ось X — время; ось Y — время ответа в миллисекундах. Нажмите график, чтобы увидеть отдельное измерение">'+
      '<defs><linearGradient id="pulse-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="var(--accent)" stop-opacity=".24"/>'+
      '<stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>'+grid+lines.join('')+pointsSvg+'</svg>'+
      (!measured.length?'<span class="chart-no-points">Данных пока нет</span>':'')+
      '</div></div>'+
      '<div class="chart-x-axis">'+xLabels+'</div>'+
      '<div class="chart-readout" id="chart-readout" aria-live="polite">'+esc(readout)+'</div>';
  }
  function showChartPoint(event) {
    const plotNode=event.target.closest(".chart-plot");
    if(!plotNode||!state.modal)return;
    const observed=hist(state.modal,state.range).filter(p=>Number.isFinite(p[2]));
    if(!observed.length)return;
    const rect=plotNode.getBoundingClientRect();
    if(!rect.width)return;
    const fraction=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
    const time=Number(plotNode.dataset.start)+fraction*(Number(plotNode.dataset.end)-Number(plotNode.dataset.start));
    const nearest=observed.reduce((best,p)=>Math.abs(new Date(p[0]).getTime()-time)<Math.abs(new Date(best[0]).getTime()-time)?p:best);
    const output=$("#chart-readout");
    if(output){
      output.textContent=fmtDate(nearest[0])+" · "+Math.round(nearest[2])+" мс · "+(STATES[nearest[1]]?.[0]||nearest[1]);
      output.classList.add("selected");
    }
    const svg=$(".chart-svg",plotNode);
    if(svg){
      const dots=$(".chart-dot",svg);
      const index=observed.findIndex(p=>p[0]===nearest[0]);
      dots.forEach((dot,i)=>dot.classList.toggle("selected",i===index));
    }
  }
  function showModal(id) {
    state.modal=id;
    state.range=24;
    renderModal();
    $("#modal-backdrop").hidden=false;
    document.body.style.overflow="hidden";
    $("#modal-close").focus();
  }
  function closeModal() {
    const id=state.modal;
    $("#modal-backdrop").hidden=true;
    state.modal=null;
    document.body.style.overflow="";
    if (id) document.querySelector('[data-check="'+CSS.escape(id)+'"]')?.focus();
  }
  function renderModal() {
    if (!state.modal) return;
    const c=checks().find(x=>x.id===state.modal);
    if (!c) {closeModal();return;}
    const result=results().get(c.id)||{};
    const points=hist(c.id,state.range);
    const numbers=points.map(p=>p[2]).filter(Number.isFinite);
    const average=numbers.length?Math.round(numbers.reduce((a,b)=>a+b,0)/numbers.length):null;
    const success=points.length?Math.round(points.filter(p=>p[1]==="ok").length/points.length*100)+"%":"—";
    const ranges=[[24,"24 часа"],[168,"7 дней"],[720,"30 дней"]];
    const extra=[
      result.http_code!==undefined?["HTTP",result.http_code]:null,
      result.grpc_code!==undefined?["gRPC",result.grpc_code]:null,
      result.error_code!==undefined?["Код сервера",result.error_code]:null,
      result.retry_after_at?["Следующая проверка не раньше",fmtDate(result.retry_after_at)]:null,
      result.reason?["Причина / тип ошибки",result.reason]:null
    ].filter(Boolean);
    const stat=(title,value)=>'<div class="detail-stat"><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong></div>';
    $("#modal-body").innerHTML =
      '<div class="modal-kicker">'+esc((cat(c.category)?.title||"СЕРВИС").toUpperCase())+' / СИНТЕТИЧЕСКАЯ ПРОВЕРКА</div>'+
      '<h2 class="modal-heading" id="modal-title">'+esc(c.name)+'</h2><div class="modal-description">'+esc(c.detail)+'</div>'+
      '<div class="modal-current">'+badge(result.status||"unknown")+'<span class="modal-time">Проверено: '+esc(fmtDate(result.checked_at))+'</span></div>'+
      '<div class="modal-section-title">Время ответа</div><div class="range-switch">'+ranges.map(r=>
        '<button class="range-btn'+(state.range===r[0]?" active":"")+'" data-range="'+r[0]+'">'+r[1]+'</button>').join("")+'</div>'+
      '<div class="history-chart">'+plot(points,state.range,state.data?.interval_minutes||30)+'</div>'+
      '<div class="graph-meta"><span>Измерений: '+points.length+'</span><span>Успешных: '+success+'</span></div>'+
      '<div class="chart-coverage">'+(points.length ? 'История наблюдений доступна с '+fmtDate(points[0][0])+'. Если за часть выбранного периода нет точек — в это время данные ещё не собирались или проверки не выполнялись.' : 'Нет измерений за выбранный период. Это не означает недоступность сервиса.')+'</div>'+
      '<div class="detail-grid">'+stat("Последний отклик",fmtMs(result.latency_ms))+
      stat("Средний отклик за период",fmtMs(average))+
      extra.map(v=>stat(v[0],v[1])).join("")+
      stat("Тип проверки",c.kind==="tcp_tls"?"TLS":c.kind.startsWith("music_")?"API":c.kind==="requires_key"?"Нужен ключ":"HTTP")+'</div>'+
      '<div class="detail-disclaimer">«Отвечает» означает успешный ответ <b>данной пробы</b> из сети GitHub Actions. Это не гарантия корректной работы всех функций сервиса для всех пользователей.'+
      (result.note?'<br><br>'+esc(result.note):'')+'</div>'+
      (c.url && c.url.startsWith("https://")?'<a class="detail-link" target="_blank" rel="noopener noreferrer" href="'+esc(c.url)+'">Открыть проверяемый адрес ↗</a>':'');
  }
  let toastTimer;
  function notify(message) {
    const toast=$("#toast");
    toast.textContent=message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>toast.classList.remove("visible"),3300);
  }
  async function fetchJson(path) {
    const response=await fetch(path+"?v="+Date.now(),{cache:"no-store"});
    if (!response.ok) throw new Error("HTTP "+response.status);
    return response.json();
  }
  async function reload(silent=false) {
    if (state.loading) return;
    state.loading=true;
    $("#refresh-button").disabled=true;
    try {
      // status.json and history.json are generated by CI, not by the browser.
      const [data,history]=await Promise.all([fetchJson("./status.json"),fetchJson("./history.json")]);
      if (!data || !Array.isArray(data.results) || !Array.isArray(data.checks)) throw Error("Неверный формат статуса");
      state.data=data;
      state.history=history;
      render();
      if (!silent) notify("Загружены последние опубликованные проверки");
    } catch(error) {
      if (!silent) notify("Данные пока не опубликованы. Проверь GitHub Actions.");
      if (!state.data) render();
      if (!silent) console.warn("Yandex Pulse: publication unavailable",error.message);
    } finally {
      state.loading=false;
      $("#refresh-button").disabled=false;
    }
  }
  function onHash() {
    const key=decodeURIComponent(location.hash.replace(/^#\/?/,"")).split("/")[0];
    state.category=cats().some(c=>c.id===key)?key:"overview";
    state.filter="all";
    $$(".filter").forEach(x=>x.classList.toggle("active",x.dataset.filter==="all"));
    render();
    if (window.scrollY>300) window.scrollTo({top:0,behavior:"smooth"});
  }
  function setTheme(mode) {
    document.documentElement.dataset.theme=mode;
    $("#theme-toggle").textContent=mode==="dark"?"☼":"☾";
    document.querySelector('meta[name="theme-color"]').content=mode==="dark"?"#101113":"#f6f6f4";
    try {localStorage.setItem("pulse-theme",mode);} catch(_) {}
  }
  function init() {
    try {
      const saved=localStorage.getItem("pulse-theme");
      setTheme(saved==="dark"||saved==="light"?saved:(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"));
    } catch(_) {setTheme("dark");}
    $("#theme-toggle").addEventListener("click",()=>setTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"));
    $("#refresh-button").addEventListener("click",()=>reload());
    $("#search").addEventListener("input",e=>{state.query=e.target.value;renderChecks();});
    $("#status-filters").addEventListener("click",e=>{
      const btn=e.target.closest("[data-filter]");
      if (!btn) return;
      state.filter=btn.dataset.filter;
      $$(".filter").forEach(x=>x.classList.toggle("active",x===btn));
      renderChecks();
    });
    $("#service-list").addEventListener("click",e=>{const btn=e.target.closest("[data-check]");if(btn)showModal(btn.dataset.check);});
    $("#modal-body").addEventListener("click",e=>{
      const btn=e.target.closest("[data-range]");
      if(!btn)return;
      state.range=Number(btn.dataset.range);
      renderModal();
    });
    $("#modal-body").addEventListener("pointerdown",showChartPoint);
    $("#modal-body").addEventListener("pointermove",e=>{if(e.pointerType==="mouse")showChartPoint(e);});
    $("#modal-close").addEventListener("click",closeModal);
    $("#modal-backdrop").addEventListener("click",e=>{if(e.target.id==="modal-backdrop")closeModal();});
    document.addEventListener("keydown",e=>{if(e.key==="Escape"&&state.modal)closeModal();});
    window.addEventListener("hashchange",onHash);
    render();
    onHash();
    reload(true);
    setInterval(()=>reload(true),60000);
    setInterval(renderHero,30000);
  }
  init();
})();