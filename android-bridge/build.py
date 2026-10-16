#!/usr/bin/env python3
"""Build the native G3 Connect app with Android SDK 35 and ECJ; no Gradle or app accounts needed.
Usage: python build.py /absolute/path/to/android-tools
See README.md for dependency versions and source URLs.
"""
from pathlib import Path
import sys,subprocess,zipfile,shutil,os
root=Path(__file__).resolve().parent;deps=Path(sys.argv[1]).resolve();work=deps/'bridge-build';work.mkdir(exist_ok=True)
platform=deps/'platform/android-35/android.jar';tools=deps/'tools/android-15'
def run(args):
 r=subprocess.run([str(x) for x in args],capture_output=True,text=True)
 if r.returncode:print(r.stdout);print(r.stderr);raise SystemExit(r.returncode)
 if r.stderr.strip():print(r.stderr[-2500:])
classes=work/'classes';shutil.rmtree(classes,ignore_errors=True);classes.mkdir()
run(['java','-jar',deps/'ecj.jar','-source','8','-target','8','-encoding','UTF-8','-proc:none','-nowarn','-bootclasspath',str(platform)+os.pathsep+str(tools/'core-lambda-stubs.jar'),'-classpath',str(deps/'tflite/classes.jar')+os.pathsep+str(deps/'tflite-api/classes.jar'),'-d',classes,*root.glob('src/**/*.java')])
jar=work/'bridge.jar'
with zipfile.ZipFile(jar,'w')as z:
 for p in classes.rglob('*.class'):z.write(p,p.relative_to(classes))
dex=work/'dex';shutil.rmtree(dex,ignore_errors=True);dex.mkdir()
run([tools/'d8','--release','--min-api','26','--lib',platform,'--output',dex,jar,deps/'tflite/classes.jar',deps/'tflite-api/classes.jar'])
unsigned=work/'unsigned.apk'
res=work/'res.zip';run([tools/'aapt2','compile','--dir',root/'res','-o',res])
run([tools/'aapt2','link','-o',unsigned,'-I',platform,'--manifest',root/'AndroidManifest.xml','-A',root/'assets','--min-sdk-version','26','--target-sdk-version','35',res])
with zipfile.ZipFile(unsigned,'a',zipfile.ZIP_DEFLATED)as z:
 for p in dex.glob('*.dex'):z.write(p,p.name)
 for p in (deps/'tflite/jni').glob('*/*.so'):z.write(p,'lib/'+str(p.relative_to(deps/'tflite/jni')))
 for p in (root/'licenses').glob('*'):z.write(p,'assets/licenses/'+p.name)
aligned=work/'aligned.apk';run([tools/'zipalign','-f','4',unsigned,aligned])
key=deps/'g3-beta-signing.jks'
if not key.exists():run(['keytool','-genkeypair','-keystore',key,'-storepass','android','-keypass','android','-alias','g3beta','-keyalg','RSA','-keysize','2048','-validity','3650','-dname','CN=G3 Connect Beta'])
out=root.parent/'dist/g3-connect.apk';out.parent.mkdir(parents=True,exist_ok=True)
run([tools/'apksigner','sign','--v4-signing-enabled','false','--ks',key,'--ks-pass','pass:android','--key-pass','pass:android','--ks-key-alias','g3beta','--out',out,aligned])
run([tools/'apksigner','verify','--verbose',out])
print('APK:',out,'bytes:',out.stat().st_size)
