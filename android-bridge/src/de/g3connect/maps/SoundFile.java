package de.g3connect.maps;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
/** Upload format for custom sounds (dist/sound-upload-analysis-en.md): 8 kHz / 16 bit / mono WAV behind a 12-byte header. */
final class SoundFile {
 static final int RATE=8000,CHUNK=128;static final float MAX_SECONDS=4f;
 /** Event slots reported by the Segway server for the G3; mask = custom-sound bit in VCU register 0x1F. */
 static final String[] EVENTS={"Custom-Taste","Alarmton","Einschaltton"};static final int[] SLOTS={71,72,73},MASKS={0x1000,0x2000,0x4000};
 /** Custom button actions (VCU 0x4A) from the G3 app configuration; 5 needs a second motor. */
 static final String[] KEY_ACTIONS={"Parkmodus ein/aus","Berganfahrhilfe ein/aus","Gehmodus ein/aus","Rekuperationsstufe wechseln","Ein-/Zweimotorbetrieb (nicht beim MAX G3)","Warnblinker","BOOST","Eigenen Sound abspielen"};
 static final int KEY_SOUND=8;
 static String keyName(int v){return v>=1&&v<=8?v+" – "+KEY_ACTIONS[v-1]:v+" (unbekannt)";}
 private static ByteBuffer le(int size){return ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);}

 /** Canonical 44-byte-header PCM16 mono WAV from samples in [-1, 1]. */
 static byte[] wav(float[] samples){
  ByteBuffer b=le(44+samples.length*2);
  b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36+samples.length*2).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short)1).putShort((short)1).putInt(RATE).putInt(RATE*2).putShort((short)2).putShort((short)16).put("data".getBytes(StandardCharsets.US_ASCII)).putInt(samples.length*2);
  for(float f:samples){float s=Math.max(-1f,Math.min(1f,f));b.putShort((short)Math.round(s<0?s*0x8000:s*0x7fff));}
  return b.array();
 }
 /** 12-byte header (12, length+12, 8000, 16, 1) followed by the complete WAV file. */
 static byte[] payload(byte[] wav){ByteBuffer b=le(12+wav.length);b.putInt(12).putInt(wav.length+12).putShort((short)RATE).put((byte)16).put((byte)1).put(wav);return b.array();}
 /** Not a CRC32: 32-bit sum of all payload bytes, bit-inverted. */
 static int checksum(byte[] payload){int sum=0;for(byte b:payload)sum+=b&255;return ~sum;}
 static byte[] le32(int v){return le(4).putInt(v).array();}
 static byte[] beginData(int length){return le(5).putInt(length).put((byte)1).array();}
 static int chunks(int length){return (length+CHUNK-1)/CHUNK;}

 /** Flow control from the 0x76 reply; last = packet the scooter already holds (-1 = none). */
 static final class Flow {final int protocol,group,last,wait;Flow(int p,int g,int l,int w){protocol=p;group=g;last=l;wait=w==5000?0:Math.max(w,0);}}
 static Flow parseBegin(byte[] d){
  ByteBuffer b=ByteBuffer.wrap(d).order(ByteOrder.LITTLE_ENDIAN);
  if(d.length>=4&&(b.getShort(0)&0xffff)==64)return new Flow(0,64,-1,b.getShort(2));
  if(d.length>=11)return new Flow(d[0]&255,b.getShort(1)&0xffff,b.getInt(3),b.getInt(7));
  return new Flow(0,8,-1,0);
 }

 /** Cut [start, start+seconds] (max. 4 s), resample linearly to 8 kHz and optionally normalise to 95 %. */
 static float[] prepare(float[] mono,int rate,float start,float seconds,boolean normalize){
  float length=Math.min(Math.min(seconds,MAX_SECONDS),Math.max(0f,mono.length/(float)rate-start));
  if(length<=0)throw new IllegalArgumentException("Startzeit liegt hinter dem Ende der Datei.");
  int n=Math.max(1,Math.round(length*RATE));float[] out=new float[n];double step=rate/(double)RATE,from=start*(double)rate;
  for(int i=0;i<n;i++){double pos=from+i*step;int a=(int)pos;float t=(float)(pos-a);float x=a<mono.length?mono[a]:0,y=a+1<mono.length?mono[a+1]:x;out[i]=x+(y-x)*t;}
  if(normalize){float peak=0;for(float s:out)peak=Math.max(peak,Math.abs(s));if(peak>0.001f)for(int i=0;i<n;i++)out[i]=out[i]/peak*0.95f;}
  return out;
 }
 /** Unmistakable test signal: three rising beeps (660, 880, 1100 Hz), 1.5 s. */
 static float[] testTone(){
  float[] out=new float[RATE*3/2];int[] freq={660,880,1100};
  for(int k=0;k<3;k++){int start=Math.round(k*0.5f*RATE),n=Math.round(0.3f*RATE);for(int i=0;i<n;i++){float env=Math.min(1f,Math.min(i/80f,(n-i)/80f));out[start+i]=(float)(0.9*env*Math.sin(2*Math.PI*freq[k]*i/RATE));}}
  return out;
 }
}
