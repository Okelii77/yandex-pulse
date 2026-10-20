/* Optional Cloudflare live API bridge. Public config contains no secrets. */
(() => {
  "use strict";
  const settings=window.PULSE_API_CONFIG || {};
  const base=String(settings.apiUrl || "").trim().replace(/\/+$/, "");
  const key=String(settings.turnstileSiteKey || "").trim();
  const enabled=() => /^https:\/\/[a-z0-9.-]+$/i.test(base);
  let triggerReady=false;
  async function refreshCapabilities(){
    if(!enabled()||!key)return false;
    try{const status=await read("/api/health");triggerReady=status.trigger_ready===true;}catch{triggerReady=false;}
    return triggerReady;
  }

  async function read(path) {
    const r=await fetch(base+path,{headers:{Accept:"application/json"},cache:"no-store"});
    if(!r.ok)throw new Error("API HTTP "+r.status);
    return r.json();
  }
  async function snapshot() {
    if(!enabled())throw Error("Worker API is not configured");
    const [status,history]=await Promise.all([read("/api/status"),read("/api/history")]);
    if(!status || !Array.isArray(status.results) || !history || !history.series)
      throw Error("Unexpected Worker response");
    return {status,history};
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
  window.PulseLive={enabled,canTrigger:()=>enabled()&&!!key&&triggerReady,refreshCapabilities,snapshot,trigger};
})();