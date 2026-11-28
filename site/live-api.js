/* Optional Cloudflare live API bridge. Public config contains no secrets. */
(() => {
  "use strict";
  const settings=window.PULSE_API_CONFIG || {};
  const base=String(settings.apiUrl || "").trim().replace(/\/+$/, "");
  const key=String(settings.turnstileSiteKey || "").trim();
  const enabled=() => /^https:\/\/[a-z0-9.-]+$/i.test(base) || (settings.localFixture===true && /^http:\/\/127\.0\.0\.1:\d+$/.test(base));
  let triggerReady=false;
  async function refreshCapabilities(){
    if(!enabled()||!key)return false;
    try{const status=await read("/api/health");triggerReady=status.trigger_ready===true;}catch{triggerReady=false;}
    return triggerReady;
  }

  async function read(path) {
    const r=await fetch(base+path,{headers:{Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw new Error("API HTTP "+r.status);
    return r.json();
  }
  let lastHistory=null, historyRevision=null, historyLoadedAt=0, lastStatus=null, statusTag=null, historyTag=null;
  async function conditional(path,tag){
    const headers={Accept:"application/json"};
    if(tag)headers["If-None-Match"]=tag;
    const r=await fetch(base+path,{headers,cache:"no-store",signal:AbortSignal.timeout(8000)});
    if(r.status===304){if(!tag)throw Error("Unexpected 304");return {same:true};}
    if(!r.ok)throw Error("API HTTP "+r.status);
    return {data:await r.json(),tag:r.headers?.get?.("ETag")||null};
  }
  async function snapshot(onStatus=()=>{}) {
    if(!enabled())throw Error("Worker API is not configured");
    const next=await conditional("/api/status",statusTag);
    const status=next.same?lastStatus:next.data;
    if(!status || !Array.isArray(status.results) || !Array.isArray(status.checks) ||
       !Number.isFinite(Date.parse(status.generated_at)))throw Error("Unexpected Worker response");
    if(lastStatus&&Date.parse(status.generated_at)<Date.parse(lastStatus.generated_at))throw Error("Stale status");
    lastStatus=status;if(!next.same)statusTag=next.tag;
    onStatus(status);
    const rcRevision=typeof lastHistory?.revision==="string"&&/^\d+-\d+$/.test(lastHistory.revision);
    if(historyRevision!==status.generated_at || Date.now()-historyLoadedAt>=300000 || rcRevision){
      try {
        const suffix=rcRevision?"?since="+encodeURIComponent(lastHistory.revision):"";
        let h=await conditional("/api/history"+suffix,historyTag);
        if(!h.same){
          let data=h.data;
          if(data?.replace){
            if(!lastHistory||data.base_revision!==lastHistory.revision||typeof data.revision!=="string"||typeof data.full_etag!=="string"||!Array.isArray(data.remove)){
              h=await conditional("/api/history",null);data=h.data;
            }else{
              const series={...lastHistory.series,...data.replace};for(const k of data.remove)delete series[k];
              h.tag=data.full_etag;data={schema:1,retention_days:30,revision:data.revision,as_of:data.as_of,series};
            }
          }
          if(!data?.series || typeof data.series!=="object" || Array.isArray(data.series))throw Error("Unexpected history response");
          lastHistory=data;historyTag=h.tag;
        }
        if(!lastHistory)throw Error("Missing history");
        historyRevision=status.generated_at;historyLoadedAt=Date.now();
      } catch { return {status,history:lastHistory,historyFresh:false}; }
    }
    return {status,history:lastHistory,historyFresh:true};
  }

  let script;
  const getTurnstile=()=>{
    if(window.turnstile)return Promise.resolve(window.turnstile);
    if(!script)script=new Promise((resolve,reject)=>{
      const node=document.createElement("script");
      node.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      node.async=true;
      node.onload=()=>window.turnstile?resolve(window.turnstile):reject(Error("Turnstile unavailable"));
      node.onerror=()=>reject(Error("Turnstile script failed"));
      document.head.appendChild(node);
    });
    return script;
  };

  let dialog=null;
  let pending=false;
  function openDialog() {
    if(!dialog) {
      dialog=document.createElement("div");
      dialog.className="pulse-trigger-backdrop";
      dialog.innerHTML='<section class="pulse-trigger-panel" role="dialog" aria-modal="true" aria-labelledby="pulse-trigger-title">'+
        '<button type="button" class="pulse-trigger-close" aria-label="Закрыть">×</button>'+
        '<div class="modal-kicker">ЗАПРОС НА ПРОВЕРКУ</div>'+
        '<h2 id="pulse-trigger-title">Проверить сейчас<span class="heading-dot">.</span></h2>'+
        '<p>Подтверди запрос — GitHub Actions проверит сервисы, а результаты появятся здесь без повторной публикации сайта.</p>'+
        '<div id="pulse-turnstile-container"></div>'+
        '<p class="pulse-trigger-state" role="status" aria-live="polite"></p>'+
        '</section>';
      dialog.querySelector(".pulse-trigger-close").addEventListener("click",()=>{dialog.hidden=true;});
      dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.hidden=true;});
      document.body.appendChild(dialog);
    }
    dialog.hidden=false;
    dialog.querySelector(".pulse-trigger-state").textContent="Проверяем запрос…";
    return dialog;
  }
  async function trigger({onStarted=()=>{},onMessage=()=>{}}={}) {
    if(!enabled())return onMessage("Worker пока не настроен");
    if(!key)return onMessage("Для запуска нужен публичный Turnstile Site Key");
    if(pending)return;
    const root=openDialog();
    const state=root.querySelector(".pulse-trigger-state");
    const host=root.querySelector("#pulse-turnstile-container");
    host.replaceChildren();
    try {
      const turnstile=await getTurnstile();
      turnstile.render(host,{
        sitekey:key,theme:"auto",size:"flexible",
        callback:async token=>{
          if(pending)return;
          pending=true;
          state.textContent="Запускаем GitHub Actions…";
          try {
            const response=await fetch(base+"/api/trigger",{
              method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({turnstileToken:token})
            });
            const data=await response.json().catch(()=>({}));
            if(response.status===429) {
              const wait=Math.ceil((data.retry_after_seconds||600)/60);
              state.textContent="Недавно уже запускали проверку. Повтор — примерно через "+wait+" мин.";
              return;
            }
            if(!response.ok) {
              state.textContent=response.status===403?
                "Проверка безопасности не пройдена. Попробуй ещё раз.":
                "Не удалось запустить проверку (HTTP "+response.status+").";
              return;
            }
            state.textContent="Проверка запущена. Ожидаем новые измерения…";
            onMessage("Диагностика запущена на GitHub Actions");
            onStarted();
            setTimeout(()=>{root.hidden=true;},1000);
          } catch(e) {
            state.textContent="Ошибка сети. Попробуй ещё раз.";
          } finally {
            pending=false;
          }
        },
        "error-callback":()=>{state.textContent="Не удалось загрузить проверку безопасности.";},
        "expired-callback":()=>{state.textContent="Срок подтверждения истёк. Закрой и открой окно повторно.";}
      });
    }catch{
      state.textContent="Cloudflare Turnstile сейчас недоступен.";
    }
  }
  window.PulseLive={enabled,canTrigger:()=>enabled()&&!!key&&triggerReady,refreshCapabilities,snapshot,ynisonStatus:()=>read("/api/ynison/status"),trigger};
})();