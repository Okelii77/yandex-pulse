#!/usr/bin/env bash
set -euo pipefail
mkdir -p evidence
cc -O2 rss_probe.c -o rss_probe
go build -trimpath -o fixture fixture.go
go build -trimpath -ldflags='-s -w' -o bench-go bench.go
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 1 -subj '/CN=Pulse offline CA' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' 2>/dev/null
openssl req -new -newkey rsa:2048 -nodes -keyout key.pem -out leaf.csr -subj '/CN=localhost' 2>/dev/null
printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n' > ext.cnf
openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out cert.pem -days 1 -extfile ext.cnf 2>/dev/null
python memory_repro.py
if [[ "${1:-}" != "--no-rust" ]]; then
 cargo generate-lockfile
 cargo build --release --locked
 cp Cargo.lock evidence/Cargo.lock
fi
{ uname -a; lscpu; python --version; node --version; go version; rustc --version || true; python -c 'import aiohttp; print(aiohttp.__version__)'; } > evidence/environment.txt
wc -c bench-go bench.py bench.mjs > evidence/sizes.txt
if [[ -e target/release/pulse2-bench ]]; then wc -c target/release/pulse2-bench >> evidence/sizes.txt; fi
