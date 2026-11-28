use std::{sync::{Arc, Mutex,mpsc},thread,time::{Instant,Duration}};
fn main(){
 let delay:u32=std::env::args().nth(1).unwrap().parse().unwrap();
 let t=Instant::now();
 let client=reqwest::blocking::Client::builder().no_proxy().http1_only().pool_max_idle_per_host(0).timeout(Duration::from_secs(9)).redirect(reqwest::redirect::Policy::none()).build().unwrap();
 let (tx,rx)=mpsc::channel::<u32>();let rx=Arc::new(Mutex::new(rx));let (done,results)=mpsc::channel();
 thread::scope(|scope|{
  for _ in 0..8 {let rx=rx.clone();let done=done.clone();let c=client.clone();scope.spawn(move || loop {
   let n={rx.lock().unwrap().recv()};let Ok(n)=n else {break};
   let r=c.get(format!("http://127.0.0.1:18761/?delay={delay}")).send().unwrap();
   assert_eq!(r.status(),200);assert_eq!(r.json::<serde_json::Value>().unwrap()["ok"],true);
   done.send(n).unwrap();
  });}
  for i in 0..23 {tx.send(i).unwrap();}
  let mut count=0;while count<25 {let n=results.recv().unwrap();count+=1;if n==22{tx.send(23).unwrap();tx.send(24).unwrap();}}
  drop(tx);
 });
 println!("{}",serde_json::json!({"ms":t.elapsed().as_secs_f64()*1000.0,"requests":25}));
}
