"""Verify a trusted-branch prebuilt Core against the exact source Git tree and SHA256."""
import hashlib,json,os,pathlib,platform,shutil,subprocess,sys,time
root=pathlib.Path(__file__).resolve().parents[2]
core=root/'research/pulse2-rc'
store=root/'research/results/pulse2/rc2-prebuilt'
dest=core/'target/release/pulse-core-rc'
def git(*args):return subprocess.check_output(['git','-C',str(root),*args],text=True).strip()
def tree():return git('rev-parse','HEAD:research/pulse2-rc')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    started=time.monotonic()
    if sys.argv[1:]==['--record']:
        store.mkdir(parents=True,exist_ok=True);shutil.copyfile(dest,store/'pulse-core-rc')
        b=store/'pulse-core-rc';m=dict(schema=1,source_commit=git('rev-parse','HEAD'),source_tree=tree(),sha256=sha(b),bytes=b.stat().st_size,toolchain='1.100.1',target='x86_64-unknown-linux-gnu',runner='ubuntu-24.04')
        (store/'manifest.json').write_text(json.dumps(m,indent=2)+'\n');print('RC2_PREBUILT',json.dumps(m));return
    if sys.argv[1:]:raise RuntimeError('invalid arguments')
    b=store/'pulse-core-rc';mf=store/'manifest.json'
    if not b.is_file() or not mf.is_file():sys.exit(2)
    m=json.loads(mf.read_text())
    if m.get('source_tree')!=tree():sys.exit(2)
    assert m.get('schema')==1 and m.get('toolchain')=='1.100.1' and m.get('runner')=='ubuntu-24.04'
    assert m.get('target')=='x86_64-unknown-linux-gnu' and platform.system()=='Linux' and platform.machine()=='x86_64'
    assert b.stat().st_size==m['bytes'] and 0<m['bytes']<=10*1024*1024 and sha(b)==m['sha256']
    # Provenance commit must be a real ancestor and contain exactly the stated source tree.
    assert git('rev-parse',m['source_commit']+':research/pulse2-rc')==m['source_tree']
    subprocess.run(['git','-C',str(root),'merge-base','--is-ancestor',m['source_commit'],'HEAD'],check=True)
    dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(b,dest);dest.chmod(0o755)
    print('RC2_PREBUILT_HIT',json.dumps(dict(bytes=m['bytes'],verify_ms=round((time.monotonic()-started)*1000,2),source_commit=m['source_commit'])))
if __name__=='__main__':main()
