//! Native public probe stage. No auth API or Ynison traffic, no publishing.
use serde::Deserialize;use serde_json::{Value,json};use std::{sync::Arc,time::{Duration,Instant}};use tokio::{net::TcpStream,time::timeout,task::JoinSet};
#[derive(Clone,Deserialize)]struct Check{id:String,kind:String,#[serde(default)]url:String,#[serde(default)]host:String,#[serde(default)]port:u16}
fn stamp()->String{chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs,true)}
fn row(c:&Check,status:&str,t:Instant)->Value{json!({"id":c.id,"status":status,"checked_at":stamp(),"latency_ms":t.elapsed().as_millis()})}
async fn probe(c:Check,client:reqwest::Client,tls:tokio_native_tls::TlsConnector)->Value{
 let t=Instant::now();
 if c.kind=="tcp_tls"{let ok=timeout(Duration::from_secs(9),async{let s=TcpStream::connect((c.host.as_str(),c.port)).await.ok()?;tls.connect(&c.host,s).await.ok()}).await.ok().flatten().is_some();
 let mut r=row(&c,if ok{"ok"}else{"down"},t);if ok{r["transport"]=json!("tls")}else{r["reason"]=json!("TlsOrNetworkError")}return r}
 match client.get(&c.url).send().await{
 Ok(r)=>{let code=r.status().as_u16();let state=match code{200..=399=>"ok",401|403|404|429=>"degraded",500..=599=>"down",_=>"unknown"};let mut v=row(&c,state,t);v["http_code"]=json!(code);v}
 Err(e)=>{let mut v=row(&c,"down",t);v["reason"]=json!(if e.is_timeout(){"TimeoutError"}else if e.is_redirect(){"RedirectError"}else{"NetworkError"});v}}
}
#[tokio::main(flavor="multi_thread",worker_threads=2)]
async fn main(){
 let began=Instant::now();let args:Vec<String>=std::env::args().collect();assert!(args.len()==3,"usage: pulse-core-rc fixture|public catalog.json");
 let fixture=args[1]=="fixture";assert!(fixture||args[1]=="public");
 // Default workflow calls fixture mode only. Real public mode must match embedded catalog exactly.
 let raw=std::fs::read_to_string(&args[2]).unwrap();
 if !fixture{assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(),serde_json::from_str::<Value>(include_str!("../../../monitor/services.json")).unwrap(),"catalog mismatch");assert_eq!(std::env::var("PULSE_RC_APPROVED_PUBLIC").as_deref(),Ok("1"),"real network not approved");}
 let catalog:Value=serde_json::from_str(&raw).unwrap();let checks:Vec<Check>=serde_json::from_value(catalog["checks"].clone()).unwrap();
 let allow=move|u:&reqwest::Url|if fixture{u.host_str()==Some("127.0.0.1")&&matches!(u.scheme(),"http"|"https")}else{u.scheme()=="https"&&u.host_str().is_some_and(|h|["yandex.ru","yandex.net","yandex.cloud","yandexcloud.net","ya.ru"].iter().any(|d|h==*d||h.ends_with(&format!(".{d}"))))};
 let mut cb=reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(9)).user_agent("YandexPulseStatusMonitor/2.0-rc").default_headers({let mut h=reqwest::header::HeaderMap::new();h.insert(reqwest::header::ACCEPT,reqwest::header::HeaderValue::from_static("text/html,application/json;q=0.9,*/*;q=0.5"));h}).redirect(reqwest::redirect::Policy::custom(move|a|if a.previous().len()>=10||!allow(a.url()){a.error("redirect blocked")}else{a.follow()}));
 let mut tb=native_tls::TlsConnector::builder();tb.min_protocol_version(Some(native_tls::Protocol::Tlsv12));
 if fixture{let ca=std::fs::read(std::env::var("PULSE_FIXTURE_CA").unwrap()).unwrap();cb=cb.add_root_certificate(reqwest::Certificate::from_pem(&ca).unwrap());tb.add_root_certificate(native_tls::Certificate::from_pem(&ca).unwrap());if std::env::var("PULSE_FIXTURE_SYSTEM_ROOTS").as_deref()!=Ok("1"){cb=cb.tls_built_in_root_certs(false);tb.disable_built_in_roots(true);}}
 let client=cb.build().unwrap();let tls=tokio_native_tls::TlsConnector::from(tb.build().unwrap());let init_ms=began.elapsed().as_secs_f64()*1000.0;let probe_begin=Instant::now();let mut jobs=JoinSet::new();let sem=Arc::new(tokio::sync::Semaphore::new(8));
 for c in checks.into_iter().filter(|c|matches!(c.kind.as_str(),"http"|"http_gateway"|"tcp_tls")){
 if c.kind=="tcp_tls"{assert!(if fixture{c.host=="127.0.0.1"}else{matches!(c.host.as_str(),"imap.yandex.ru"|"smtp.yandex.ru")});}else{assert!(allow(&reqwest::Url::parse(&c.url).unwrap()));}
 let(client,tls,sem)=(client.clone(),tls.clone(),sem.clone());jobs.spawn(async move{let _permit=sem.acquire_owned().await.unwrap();probe(c,client,tls).await});}
 let mut rows=vec![];while let Some(r)=jobs.join_next().await{rows.push(r.unwrap());}rows.sort_by_key(|r|r["id"].as_str().unwrap().to_string());
 let probe_ms=probe_begin.elapsed().as_secs_f64()*1000.0;let mem=std::fs::read_to_string("/proc/self/status").unwrap_or_default();let hwm=mem.lines().find(|x|x.starts_with("VmHWM:")).and_then(|x|x.split_whitespace().nth(1)).and_then(|x|x.parse::<u64>().ok());println!("{}",json!({"results":rows,"metrics":{"init_ms":init_ms,"probe_ms":probe_ms,"hwm_kib":hwm}}));}
