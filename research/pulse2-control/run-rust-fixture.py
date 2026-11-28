"""One native Core execution against loopback TLS/HTTP only. No account credentials."""
import copy, http.server as h, json, os, pathlib, ssl, subprocess as sp, tempfile, threading, time
ROOT=pathlib.Path(__file__).resolve().parents[2]
def run(catalog):
    class Server(h.ThreadingHTTPServer):
        daemon_threads=True
        request_queue_size=128
    class Handler(h.BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def do_GET(self):
            time.sleep(.03)
            self.send_response(int(self.path[1:]));self.end_headers()
    with tempfile.TemporaryDirectory() as d:
        p=pathlib.Path(d)
        def openssl(*args):sp.run(["openssl",*args],check=True,capture_output=True)
        openssl("req","-x509","-newkey","rsa:2048","-nodes","-keyout",str(p/"ca.key"),"-out",str(p/"ca.pem"),"-days","1","-subj","/CN=RC2 fixture CA","-addext","basicConstraints=critical,CA:TRUE","-addext","keyUsage=critical,keyCertSign,cRLSign")
        openssl("req","-new","-newkey","rsa:2048","-nodes","-keyout",str(p/"key"),"-out",str(p/"csr"),"-subj","/CN=127.0.0.1")
        (p/"ext").write_text("basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n")
        openssl("x509","-req","-in",str(p/"csr"),"-CA",str(p/"ca.pem"),"-CAkey",str(p/"ca.key"),"-CAcreateserial","-out",str(p/"cert"),"-days","1","-extfile",str(p/"ext"))
        a,b=[Server(("127.0.0.1",0),Handler) for _ in range(2)]
        ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(p/"cert",p/"key");b.socket=ctx.wrap_socket(b.socket,server_side=True)
        for s in (a,b):threading.Thread(target=s.serve_forever,daemon=True).start()
        try:
            fixture=copy.deepcopy(catalog);expected={}
            for c in fixture["checks"]:
                if c["kind"]=="tcp_tls":
                    c.update(host="127.0.0.1",port=b.server_port);expected[c["id"]]="ok"
                elif c["kind"] in ("http","http_gateway"):
                    code=403 if c["id"]=="cloud-storage" else 503 if c["id"]=="other-weather" else 200
                    c["url"]=f"https://127.0.0.1:{b.server_port}/{code}" if c["id"]=="music-catalog" else f"http://127.0.0.1:{a.server_port}/{code}"
                    expected[c["id"]]="down" if code==503 else "degraded" if code==403 else "ok"
            file=p/"catalog.json";file.write_text(json.dumps(fixture))
            binary=ROOT/"research/pulse2-rc/target/release/pulse-core-rc"
            t=time.monotonic()
            data=json.loads(sp.check_output([str(binary),"fixture",str(file)],env={"PULSE_FIXTURE_CA":str(p/"ca.pem")},timeout=20))
            assert len(expected)==22 and {x["id"]:x["status"] for x in data["results"]}==expected
            print("RC2_NATIVE_FIXTURE",json.dumps(dict(data["metrics"],wall_ms=round((time.monotonic()-t)*1000,2),checks=22,binary_bytes=binary.stat().st_size)),flush=True)
            return data["results"]
        finally:
            for s in (a,b):s.shutdown();s.server_close()
if __name__=="__main__":run(json.loads((ROOT/"monitor/services.json").read_text()))
