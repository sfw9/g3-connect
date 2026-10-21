#!/usr/bin/env python3
"""Host tests for the exact pure-Java protocol and navigation core shipped in the APK."""
from pathlib import Path
import sys,subprocess,os,shutil
r=Path(__file__).resolve().parent;d=Path(sys.argv[1]).resolve();platform=d/'platform/android-35/android.jar';out=d/'native-tests';shutil.rmtree(out,ignore_errors=True);out.mkdir()
sources=[r/'tests/NativeTests.java']+[r/'src/de/g3connect/maps'/name for name in ['Guidance.java','IconPixels.java','MapsNotification.java','ArrivalTime.java','MapsState.java','NaviPacket.java','NinebotCrypto.java','NinebotClient.java','NavigationLoop.java','ManualSender.java','SoundFile.java']]
subprocess.run(['java','-jar',str(d/'ecj.jar'),'-source','8','-target','8','-encoding','UTF-8','-proc:none','-nowarn','-bootclasspath',str(platform)+os.pathsep+str(d/'tools/android-15/core-lambda-stubs.jar'),'-classpath',str(d/'json.jar'),'-d',str(out),*map(str,sources)],check=True)
subprocess.run(['java','-cp',os.pathsep.join(map(str,[out,d/'json.jar'])),'de.g3connect.maps.NativeTests',str(r.parent/'tests/vectors.json')],check=True)
