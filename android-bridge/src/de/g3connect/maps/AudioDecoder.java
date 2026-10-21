package de.g3connect.maps;
import android.content.Context;
import android.media.*;
import android.net.Uri;
import java.nio.*;
/** Decodes any audio file Android supports (MP3, M4A, OGG, WAV …) to mono float PCM at its own sample rate. */
final class AudioDecoder {
 static final class Pcm {final float[] mono;final int rate;Pcm(float[] m,int r){mono=m;rate=r;}float seconds(){return mono.length/(float)rate;}}
 private static final int MAX_SECONDS=120;
 static Pcm decode(Context context,Uri uri)throws Exception{
  MediaExtractor extractor=new MediaExtractor();MediaCodec codec=null;
  try{
   extractor.setDataSource(context,uri,null);MediaFormat format=null;
   for(int i=0;i<extractor.getTrackCount()&&format==null;i++){MediaFormat f=extractor.getTrackFormat(i);String mime=f.getString(MediaFormat.KEY_MIME);if(mime!=null&&mime.startsWith("audio/")){extractor.selectTrack(i);format=f;}}
   if(format==null)throw new IllegalArgumentException("Keine Audiospur in der Datei.");
   int rate=format.getInteger(MediaFormat.KEY_SAMPLE_RATE),channels=format.getInteger(MediaFormat.KEY_CHANNEL_COUNT),encoding=AudioFormat.ENCODING_PCM_16BIT;
   codec=MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));codec.configure(format,null,null,0);codec.start();
   float[] out=new float[rate*4];int size=0;boolean inputDone=false;MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
   while(true){
    if(!inputDone){int in=codec.dequeueInputBuffer(10000);if(in>=0){ByteBuffer buffer=codec.getInputBuffer(in);int n=extractor.readSampleData(buffer,0);
     if(n<0){codec.queueInputBuffer(in,0,0,0,MediaCodec.BUFFER_FLAG_END_OF_STREAM);inputDone=true;}else{codec.queueInputBuffer(in,0,n,extractor.getSampleTime(),0);extractor.advance();}}}
    int o=codec.dequeueOutputBuffer(info,10000);
    if(o==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){MediaFormat f=codec.getOutputFormat();rate=f.getInteger(MediaFormat.KEY_SAMPLE_RATE);channels=f.getInteger(MediaFormat.KEY_CHANNEL_COUNT);if(f.containsKey(MediaFormat.KEY_PCM_ENCODING))encoding=f.getInteger(MediaFormat.KEY_PCM_ENCODING);continue;}
    if(o<0)continue;
    ByteBuffer buffer=codec.getOutputBuffer(o);buffer.position(info.offset);buffer.limit(info.offset+info.size);buffer=buffer.slice().order(ByteOrder.LITTLE_ENDIAN);
    // Mix all channels to mono.
    if(encoding==AudioFormat.ENCODING_PCM_FLOAT){FloatBuffer f=buffer.asFloatBuffer();while(f.remaining()>=channels){float s=0;for(int c=0;c<channels;c++)s+=f.get();if(size==out.length)out=java.util.Arrays.copyOf(out,size*2);out[size++]=s/channels;}}
    else{ShortBuffer f=buffer.asShortBuffer();while(f.remaining()>=channels){float s=0;for(int c=0;c<channels;c++)s+=f.get()/32768f;if(size==out.length)out=java.util.Arrays.copyOf(out,size*2);out[size++]=s/channels;}}
    codec.releaseOutputBuffer(o,false);
    if((info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0||size>=rate*MAX_SECONDS)break;
   }
   if(size==0)throw new IllegalArgumentException("Datei enthält keine hörbaren Daten.");
   return new Pcm(java.util.Arrays.copyOf(out,size),rate);
  }finally{if(codec!=null)try{codec.stop();}catch(Exception ignored){}if(codec!=null)codec.release();extractor.release();}
 }
 /** Plays 8 kHz samples once through the media stream. Returns the track so it can be released. */
 static AudioTrack play(float[] samples){
  short[] pcm=new short[samples.length];for(int i=0;i<pcm.length;i++){float s=Math.max(-1f,Math.min(1f,samples[i]));pcm[i]=(short)Math.round(s<0?s*0x8000:s*0x7fff);}
  AudioTrack track=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
   .setAudioFormat(new AudioFormat.Builder().setSampleRate(SoundFile.RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
   .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(Math.max(pcm.length*2,1024)).build();
  track.write(pcm,0,pcm.length);track.play();return track;
 }
}
