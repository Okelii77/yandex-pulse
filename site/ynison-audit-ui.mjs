import {summarizeHar} from "./ynison-har-core.mjs";
const upload=document.querySelector("#file");
const status=document.querySelector("#status");
const table=document.querySelector("#results");
const output=document.querySelector("#safe-report");
const button=document.querySelector("#copy");
const maxSize=24*1024*1024;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
upload.addEventListener("change",async()=>{
  status.textContent="";output.value="";table.replaceChildren();button.disabled=true;
  const file=upload.files?.[0];
  if(!file)return;
  try{
    if(file.size>maxSize)throw Error("Файл больше 24 МБ — экспортируйте только небольшой сеанс с Network → WS.");
    const raw=await file.text();
    const parsed=JSON.parse(raw);
    const safe=summarizeHar(parsed);
    // Raw HAR and raw JSON are immediately discarded after sanitization.
    output.value=JSON.stringify(safe,null,2);
    status.textContent=safe.note;
    button.disabled=false;
    for(const [index,r] of safe.requests.entries()){
      const tr=document.createElement("tr");
      for(const text of [index+1,r.stage,r.transport,r.result_status,r.auth,r.origin,r.protocol_v2?"v2":"—",r.header_device_type,r.app_name_profile,r.ticket_present?"да":"нет"]){
        const td=document.createElement("td");td.textContent=String(text);tr.append(td);
      }
      table.append(tr);
    }
  }catch(error){
    // Only controlled error messages: never echo arbitrary HAR content to UI.
    status.textContent=error instanceof SyntaxError?
      "Файл не похож на корректный JSON HAR.": 
      error instanceof Error && ["Это не HAR: отсутствует log.entries.","HAR слишком большой по числу запросов.","Файл больше 24 МБ — экспортируйте только небольшой сеанс с Network → WS."].includes(error.message)?
       error.message:"Не удалось разобрать HAR. Проверьте формат файла.";
  }finally{upload.value="";}
});
button.addEventListener("click",async()=>{
  try{await navigator.clipboard.writeText(output.value);status.textContent="Скопирована только очищенная сводка. HAR не отправлялся."; }
  catch{output.focus();output.select();status.textContent="Выделен очищенный отчёт — скопируйте его вручную."; }
});
