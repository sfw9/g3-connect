package de.g3connect.maps;
/** In-memory only; navigation text and roads never enter persisted logs. */
final class MapsState {
 static volatile boolean listenerReady;
 static volatile String diagnostic="Noch keine Google-Maps-Navigationsmeldung erfasst.";
 static volatile Sample current;
 static volatile String status="Noch kein Google-Maps-Hinweis.";
 static final class Sample {
  final int step,remaining,seconds,icon;final float confidence;final String road,currentRoad;final long observedAt;final boolean distancePlaceholder;
  Sample(int step,int remaining,int seconds,int icon,float confidence,String road,long time){this(step,remaining,seconds,icon,confidence,road,time,false);}
  Sample(int step,int remaining,int seconds,int icon,float confidence,String road,long time,boolean placeholder){this(step,remaining,seconds,icon,confidence,road,time,placeholder,"");}
  Sample(int step,int remaining,int seconds,int icon,float confidence,String road,long time,boolean placeholder,String currentRoad){this.step=step;this.remaining=remaining;this.seconds=seconds;this.icon=icon;this.confidence=confidence;this.road=road;this.currentRoad=currentRoad;this.observedAt=time;this.distancePlaceholder=placeholder;}
  boolean valid(){return step>=0&&remaining>=step&&seconds>=0&&confidence>=.90f&&confidence<=1&&(icon>=2&&icon<=9||icon==11||icon==12||icon==15);}
 }
 static void clear(String reason){current=null;status=reason;}
}
