use worker::*;use serde::Deserialize;
#[derive(Deserialize)]struct Row{v:u32}
#[event(fetch)]pub async fn main(req:Request,env:Env,_ctx:Context)->Result<Response>{if req.path()=="/ping"{return Response::ok("ping")}let db=env.d1("DB")?;let rows=db.prepare("SELECT v FROM lab_values ORDER BY id").all().await?.results::<Row>()?;let sum:u32=rows.iter().map(|x|x.v).sum();Response::from_json(&serde_json::json!({"count":rows.len(),"sum":sum}))}
