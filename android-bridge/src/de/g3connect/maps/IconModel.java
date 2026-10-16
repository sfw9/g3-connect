package de.g3connect.maps;
import android.content.Context;
import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.Icon;
import java.nio.*;
import java.io.*;
import java.util.*;
import org.tensorflow.lite.Interpreter;
/** Model and preprocessing reference: OpenDash/KTM-Nav-GEN3 (MIT); see licenses/. */
final class IconModel {
 private Interpreter model;private int[] labels;private int lastHash;private boolean cached;private Result lastResult;
 static final class Result {final int icon;final float score;final int foregroundPixels;final String inputMode;Result(int i,float s){this(i,s,0,"notRun");}Result(int i,float s,int count,String mode){icon=i;score=s;foregroundPixels=count;inputMode=mode;}}
 IconModel(Context c)throws Exception {
  byte[] bytes=read(c.getAssets().open("maneuver_model.tflite"));
  ByteBuffer buffer=ByteBuffer.allocateDirect(bytes.length).order(ByteOrder.nativeOrder());buffer.put(bytes).rewind();
  model=new Interpreter(buffer,new Interpreter.Options().setNumThreads(1));
  String text=new String(read(c.getAssets().open("maneuver_labels.txt")),"UTF-8").trim();String[] lines=text.split("\\s+");labels=new int[lines.length];
  for(int i=0;i<lines.length;i++)labels[i]=Integer.parseInt(lines[i]);
  int[] shape=model.getInputTensor(0).shape(),output=model.getOutputTensor(0).shape();
  if(!Arrays.equals(shape,new int[]{1,96,96,3})||output.length!=2||output[1]!=labels.length)throw new IllegalStateException("Modellformat passt nicht.");
 }
 synchronized Result classify(Context c,Icon icon){
  if(icon==null)return new Result(-1,0);
  Bitmap bitmap=Bitmap.createBitmap(48,48,Bitmap.Config.ARGB_8888);Bitmap scaled=null;
  try{
   Drawable d=icon.loadDrawable(c);if(d==null)return new Result(-1,0);
   Canvas canvas=new Canvas(bitmap);canvas.drawColor(Color.TRANSPARENT,PorterDuff.Mode.CLEAR);d.setBounds(0,0,48,48);d.draw(canvas);
   scaled=Bitmap.createScaledBitmap(bitmap,96,96,true);
   int[] pixels=new int[96*96];scaled.getPixels(pixels,0,96,0,0,96,96);IconPixels.Prepared prepared=IconPixels.prepare(pixels);if(prepared.foreground==0)return new Result(-1,0,0,prepared.mode);int hash=Arrays.hashCode(prepared.gray);
   if(cached&&hash==lastHash)return new Result(lastResult.icon,lastResult.score,prepared.foreground,prepared.mode);
   ByteBuffer input=ByteBuffer.allocateDirect(96*96*3*4).order(ByteOrder.nativeOrder());
   for(int p:prepared.gray){float value=p/255f;input.putFloat(value);input.putFloat(value);input.putFloat(value);}input.rewind();
   float[][] output=new float[1][labels.length];model.run(input,output);int best=0;
   for(int i=1;i<labels.length;i++)if(output[0][i]>output[0][best])best=i;
   float score=output[0][best];int id=score>=0.90f?Guidance.ninebotIcon(labels[best]):-1;
   lastHash=hash;cached=true;lastResult=new Result(id,score,prepared.foreground,prepared.mode);return lastResult;
  }catch(Exception e){return new Result(-1,0);}finally{if(scaled!=null&&scaled!=bitmap)scaled.recycle();bitmap.recycle();}
 }
 void close(){if(model!=null){model.close();model=null;}}
 private static byte[] read(InputStream stream)throws IOException {try(InputStream in=stream;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];for(int n;(n=in.read(b))!=-1;)out.write(b,0,n);return out.toByteArray();}}
}
