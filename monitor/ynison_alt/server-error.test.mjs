import {test} from "node:test";
import assert from "node:assert/strict";
import {safeServerError,safeHandshakeError} from "./server-error.mjs";
test("preserve longest server cooldown without exporting text or account data",()=>{
  const result=safeServerError({http_code:503,grpc_code:14,message:"PRIVATE",details:{"ynison-error-code":"500140000","ynison-go-away-for-seconds":"3600"},extra_headers:{"ynison-go-away-for-seconds":"7200","token":"PRIVATE"}});
  assert.deepEqual(result,{status:"error",stage:"server",http_code:503,grpc_code:14,error_code:500140000,retry_after_seconds:7200});
});
test("HTTP handshake cooldown is preserved",()=>{
  assert.equal(safeHandshakeError(503,{"retry-after":"3600"},"redirector").retry_after_seconds,3600);
  assert.equal(safeHandshakeError(503,{"ynison-go-away-for-seconds":"broken"},"state").status,"unknown");
});
