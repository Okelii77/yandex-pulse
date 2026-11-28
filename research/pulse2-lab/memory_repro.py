import subprocess,json,pathlib
rows=[]
for mib in (0,64,128):
 b=bytearray(mib*1024*1024)
 for i in range(0,len(b),4096):b[i]=1
 rows.append({'parent_extra_mib':mib,'child':subprocess.check_output(['./rss_probe'],text=True)})
 del b
pathlib.Path('evidence/memory-repro.json').write_text(json.dumps(rows,indent=2))
print(rows)
