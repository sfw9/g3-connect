#!/usr/bin/env python3
"""Fetch pinned, hash-checked public SDK/build dependencies into an external directory."""
import sys,json,hashlib,urllib.request,zipfile
from pathlib import Path
root=Path(__file__).resolve().parent;dest=Path(sys.argv[1]).resolve();dest.mkdir(parents=True,exist_ok=True)
for name,entry in json.loads((root/'dependencies.json').read_text()).items():
 p=dest/name
 if not p.exists():
  print('Downloading',name,flush=True)
  with urllib.request.urlopen(entry['url'],timeout=60)as r,p.open('wb')as out:
   while b:=r.read(1024*1024):out.write(b)
 if hashlib.file_digest(p.open('rb'),'sha256').hexdigest()!=entry['sha256']:raise SystemExit('Checksum mismatch: '+name)
 if name.endswith(('.zip','.aar')):
  folder=dest/name.rsplit('.',1)[0]
  if not folder.exists():
   with zipfile.ZipFile(p)as z:z.extractall(folder)
for p in (dest/'tools').rglob('*'):
 if p.name in ['aapt2','d8','zipalign','apksigner'] and p.is_file():p.chmod(0o755)
print('Prepared',dest)
