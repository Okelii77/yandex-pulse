//! Read-only Music REST candidate, deliberately fixture-only until approved live parity.
use serde_json::{Value,json};use std::time::Duration;
async fn get(client:&reqwest::Client,base:&str,path:&str,device:bool)->(&'static str,Option<Value>){
 let mut q=client.get(format!("{base}{path}")).header("Authorization","OAuth synthetic-fixture").header("Accept","application/json");
 if device{q=q.header("X-Yandex-Music-Device","os=PulseRC; os_version=; manufacturer=Pulse; model=Pulse Core; clid=; device_id=fixture; uuid=fixture");}
 let Ok(mut r)=q.send().await else{return ("down",None)};
 let code=r.status().as_u16();if code==429{return ("degraded",None)}if code!=200{return ("down",None)}
 let mut body=vec![];while let Ok(Some(chunk))=r.chunk().await{if body.len()+chunk.len()>393216{return ("degraded",None)}body.extend_from_slice(&chunk);}
 match serde_json::from_slice::<Value>(&body){Ok(v) if v.get("error").is_none()=>match v.get("result"){Some(x) if !x.is_null()=>("ok",Some(x.clone())),Some(_)=>("no_data",None),None=>("degraded",None)},_=>("degraded",None)}
}
#[tokio::main(flavor="current_thread")]
async fn main(){let base=std::env::args().nth(1).expect("fixture origin");let u=reqwest::Url::parse(&base).unwrap();assert!(u.scheme()=="http"&&u.host_str()==Some("127.0.0.1")&&u.username().is_empty()&&u.path()=="/"&&u.query().is_none());let c=reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(2)).redirect(reqwest::redirect::Policy::none()).build().unwrap();
 let (s,account)=get(&c,&base,"/account/status",false).await;let status=if s=="ok"{if account.as_ref().and_then(|x|x.pointer("/account/uid")).is_some_and(|x|x.as_u64().is_some()||x.as_str().is_some_and(|s|!s.is_empty()&&s.bytes().all(|b|b.is_ascii_digit()))){ "ok" }else{"degraded"}}else{s};
 let (h,history)=get(&c,&base,"/music-history?fullModelsCount=1",false).await;
 let history_status=if h=="ok"{match history.as_ref().and_then(|x|x.get("historyTabs")).and_then(Value::as_array){Some(a) if a.is_empty()=>"no_data",Some(_)=>"ok",None=>"degraded"}}else{h};
 let (q,queues)=get(&c,&base,"/queues",true).await;
 let queue_status=if q=="ok"{match queues.as_ref().and_then(|x|x.get("queues")).and_then(Value::as_array){Some(a) if a.is_empty()=>"no_data",Some(a) if a.iter().all(|x|x.get("id").and_then(Value::as_str).is_some_and(|s|!s.is_empty())&&x.get("modified").and_then(Value::as_str).is_some())=>"ok",_=>"degraded"}}else{q};
 println!("{}",json!({"music-rest":status,"music-history":history_status,"music-queues":queue_status}));}
