//! Native public probe stage. No auth API or Ynison traffic, no publishing.
use serde::Deserialize;use serde_json::{Value,json};use std::{sync::Arc,time::{Duration,Instant}};use tokio::{net::TcpStream,time::timeout,task::JoinSet};
#[derive(Clone,Deserialize)]struct Check{id:String,kind:String,#[serde(default)]url:String,#[serde(default)]host:String,#[serde(default)]port:u16}
fn stamp()->String{time::OffsetDateTime::now_utc().replace_nanosecond(0).unwrap().format(&time::format_description::well_known::Rfc3339).unwrap()}
fn row(c:&Check,status:&str,t:Instant)->Value{json!({"id":c.id,"status":status,"checked_at":stamp(),"latency_ms":t.elapsed().as_millis()})}
async fn probe(c:Check,client:reqwest::Client,tls:tokio_rustls::TlsConnector)->Value{
 let t=Instant::now();
 if c.kind=="tcp_tls"{let ok=timeout(Duration::from_secs(9),async{let s=TcpStream::connect((c.host.as_str(),c.port)).await.ok()?;tls.connect(rustls::pki_types::ServerName::try_from(c.host.clone()).ok()?,s).await.ok()}).await.ok().flatten().is_some();
 let mut r=row(&c,if ok{"ok"}else{"down"},t);if ok{r["transport"]=json!("tls")}else{r["reason"]=json!("TlsOrNetworkError")}return r}
 match client.get(&c.url).send().await{
 Ok(r)=>{let code=r.status().as_u16();let state=match code{200..=399=>"ok",401|403|404|429=>"degraded",500..=599=>"down",_=>"unknown"};let mut v=row(&c,state,t);v["http_code"]=json!(code);v}
 Err(e)=>{let mut v=row(&c,"down",t);v["reason"]=json!(if e.is_timeout(){"TimeoutError"}else if e.is_redirect(){"RedirectError"}else{"NetworkError"});v}}
}
#[tokio::main(flavor="current_thread")]
async fn main(){
 let began=Instant::now();let args:Vec<String>=std::env::args().collect();assert!(args.len()==3,"usage: pulse-core-rc fixture|public catalog.json");
 let fixture=args[1]=="fixture";assert!(fixture||args[1]=="public");
 // Default workflow calls fixture mode only. Real public mode must match embedded catalog exactly.
 let raw=std::fs::read_to_string(&args[2]).unwrap();
 if !fixture{assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(),serde_json::from_str::<Value>(include_str!("../../../monitor/services.json")).unwrap(),"catalog mismatch");assert_eq!(std::env::var("PULSE_RC_APPROVED_PUBLIC").as_deref(),Ok("1"),"real network not approved");}
 let catalog:Value=serde_json::from_str(&raw).unwrap();let checks:Vec<Check>=serde_json::from_value(catalog["checks"].clone()).unwrap();
 let allow=move|u:&reqwest::Url|if fixture{u.host_str()==Some("127.0.0.1")&&matches!(u.scheme(),"http"|"https")}else{u.scheme()=="https"&&u.host_str().is_some_and(|h|["yandex.ru","yandex.net","yandex.cloud","yandexcloud.net","ya.ru"].iter().any(|d|h==*d||h.ends_with(&format!(".{d}"))))};
 let prepare_begin=Instant::now();let cb=reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(9)).user_agent("YandexPulseStatusMonitor/2.0-rc").default_headers({let mut h=reqwest::header::HeaderMap::new();h.insert(reqwest::header::ACCEPT,reqwest::header::HeaderValue::from_static("text/html,application/json;q=0.9,*/*;q=0.5"));h}).redirect(reqwest::redirect::Policy::custom(move|a|if a.previous().len()>=10||!allow(a.url()){a.error("redirect blocked")}else{a.follow()}));
 let mut roots=rustls::RootCertStore::empty();let roots_begin=Instant::now();
 if fixture{let ca=std::fs::read(std::env::var("PULSE_FIXTURE_CA").unwrap()).unwrap();use rustls::pki_types::pem::PemObject;for cert in rustls::pki_types::CertificateDer::pem_slice_iter(&ca){roots.add(cert.unwrap()).unwrap();}}
 if !fixture||std::env::var("PULSE_FIXTURE_SYSTEM_ROOTS").as_deref()==Ok("1"){let native=rustls_native_certs::load_native_certs();let (accepted,_)=roots.add_parsable_certificates(native.certs);assert!(accepted>0,"no trusted system roots");}
 assert!(!roots.is_empty());let roots_ms=roots_begin.elapsed().as_secs_f64()*1000.0;
 let config=rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider())).with_safe_default_protocol_versions().unwrap().with_root_certificates(roots).with_no_client_auth();
 let tls=tokio_rustls::TlsConnector::from(Arc::new(config.clone()));let client_begin=Instant::now();let client=cb.tls_backend_preconfigured(config).build().unwrap();let client_ms=client_begin.elapsed().as_secs_f64()*1000.0;let init_ms=began.elapsed().as_secs_f64()*1000.0;let config_ms=prepare_begin.elapsed().as_secs_f64()*1000.0;let probe_begin=Instant::now();let mut jobs=JoinSet::new();let sem=Arc::new(tokio::sync::Semaphore::new(8));
 for c in checks.into_iter().filter(|c|matches!(c.kind.as_str(),"http"|"http_gateway"|"tcp_tls")){
 if c.kind=="tcp_tls"{assert!(if fixture{c.host=="127.0.0.1"}else{matches!(c.host.as_str(),"imap.yandex.ru"|"smtp.yandex.ru")});}else{assert!(allow(&reqwest::Url::parse(&c.url).unwrap()));}
 let(client,tls,sem)=(client.clone(),tls.clone(),sem.clone());jobs.spawn(async move{let _permit=sem.acquire_owned().await.unwrap();probe(c,client,tls).await});}
 let mut rows=vec![];while let Some(r)=jobs.join_next().await{rows.push(r.unwrap());}rows.sort_by_key(|r|r["id"].as_str().unwrap().to_string());
 let probe_ms=probe_begin.elapsed().as_secs_f64()*1000.0;let mem=std::fs::read_to_string("/proc/self/status").unwrap_or_default();let hwm=mem.lines().find(|x|x.starts_with("VmHWM:")).and_then(|x|x.split_whitespace().nth(1)).and_then(|x|x.parse::<u64>().ok());println!("{}",json!({"results":rows,"metrics":{"init_ms":init_ms,"roots_ms":roots_ms,"http_client_ms":client_ms,"config_ms":config_ms,"probe_ms":probe_ms,"hwm_kib":hwm}}));}
