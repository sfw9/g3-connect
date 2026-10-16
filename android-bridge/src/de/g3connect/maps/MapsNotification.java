package de.g3connect.maps;
import java.util.*;
import java.util.regex.*;
/** Pure parser for whitelisted Google Maps text fields. Uses explicit durations first; arrival-clock subtraction is an approximate fallback. */
final class MapsNotification {
 static final int PLACEHOLDER_METERS=1_337_000; // User-requested 1337 km when Maps omits route distance.
 static final String TITLE="android.title",BIG_TITLE="android.title.big",TEXT="android.text",BIG_TEXT="android.bigText",LINES="android.textLines",SUB="android.subText",SUMMARY="android.summaryText",INFO="android.infoText";
 static final String[] FIELDS={TITLE,BIG_TITLE,TEXT,BIG_TEXT,LINES,SUB,SUMMARY,INFO};
 private static final Pattern PREFIX=Pattern.compile("(?iu)^(?:(?:in|after|nach|noch)\\s+)?[0-9]+(?:[.,][0-9]+)?\\s*(?:km|mi|m|ft)\\b");
 static final class Turn {final int icon;final String rest;final boolean departure;Turn(int icon,String rest){this(icon,rest,false);}Turn(int icon,String rest,boolean departure){this.icon=icon;this.rest=rest;this.departure=departure;}}
 static final class Result {
  final Integer step,remaining,seconds;final int icon;final float confidence;final boolean textDirection,secondsEstimated,stepImmediate,departure;final String road;
  Result(Integer step,Integer remaining,Integer seconds,int icon,float confidence,boolean textDirection,String road,boolean estimated,boolean immediate,boolean departure){this.step=step;this.remaining=remaining;this.seconds=seconds;this.icon=icon;this.confidence=confidence;this.textDirection=textDirection;this.road=road;this.secondsEstimated=estimated;this.stepImmediate=immediate;this.departure=departure;}
  boolean candidate(){return step!=null||icon>=0;}
  boolean distancePlaceholder(){return remaining==null;}
  int displayRemaining(){return distancePlaceholder()?PLACEHOLDER_METERS:remaining;}
  MapsState.Sample sample(long now){if(step==null||seconds==null)return null;MapsState.Sample s=new MapsState.Sample(step,displayRemaining(),seconds,icon,confidence,road,now,distancePlaceholder());return s.valid()?s:null;}
  String status(){
   String turn=departure?"Start / weiterfahren":icon==3?"rechts":icon==2?"links":icon==9?"geradeaus":icon<0?"Richtung fehlt":"Pfeil "+icon;
   String preview="Maps: "+turn+(step==null?" · Abbiegedistanz fehlt":stepImmediate?" · jetzt":" · in "+step+" m")+(seconds==null?"":" · "+(secondsEstimated?"ca. ":"")+(int)Math.ceil(seconds/60.0)+" min Restfahrzeit")+(distancePlaceholder()?" · Reststrecke: 1337 km (Platzhalter)":"");
   if(step==null||seconds==null)return preview+" · "+(seconds==null?"Restfahrzeit fehlt. ":"")+"Keine Display-Übertragung.";
   if(icon<0||confidence<.90f)return preview+" · Pfeil nicht sicher erkannt. Keine Übertragung.";
   if(displayRemaining()<step)return preview+" · Streckenangaben widersprüchlich. Keine Übertragung.";
   return preview+" · "+(textDirection?"Richtung aus Maps-Text.":"Modellscore "+Math.round(confidence*100)+" %.");
  }
 }
 static Result parse(Map<String,String> fields,int modelIcon,float modelScore){return parse(fields,modelIcon,modelScore,System.currentTimeMillis(),TimeZone.getDefault());}
 static Result parse(Map<String,String> fields,int modelIcon,float modelScore,long now,TimeZone zone){
  Integer step=null;Turn explicit=null;String road="";
  for(String key:new String[]{TITLE,BIG_TITLE,TEXT,BIG_TEXT,LINES}){
   String value=clean(fields.get(key));if(value.isEmpty())continue;
   Matcher prefix=PREFIX.matcher(value);Integer meters=null;String instruction=value;
   if(prefix.find()){meters=bounded(Guidance.meters(prefix.group()));instruction=value.substring(prefix.end()).replaceFirst("^[\\s·•:–—-]+","").trim();}
   Turn turn=turn(instruction);
   if(meters!=null&&step==null)step=meters;
   if(turn!=null&&explicit==null){explicit=turn;road=road(turn.rest);if(meters!=null)step=meters;}
  }
  boolean immediate=step==null&&explicit!=null;
  if(immediate)step=0; // Explicit instruction without a distance applies now; not a measured segment length.
  Integer remaining=null,seconds=null;
  // Summary fields describe the route. Never take the next-turn distance from the instruction as total distance.
  for(String key:new String[]{SUB,SUMMARY,INFO}){String value=clean(fields.get(key));if(value.isEmpty()||hasInstruction(value))continue;if(remaining==null)remaining=bounded(Guidance.meters(value));if(seconds==null)seconds=Guidance.seconds(value);}
  boolean estimated=false;
  if(seconds==null)for(String key:new String[]{SUB,SUMMARY,INFO}){Integer estimate=ArrivalTime.seconds(fields.get(key),now,zone);if(estimate!=null){seconds=estimate;estimated=true;break;}}
  if(road.isEmpty()){
   String text=clean(fields.get(TEXT));
   if(!text.isEmpty()&&turn(text)==null&&!PREFIX.matcher(text).find()&&Guidance.seconds(text)==null&&!text.matches("(?iu).*\\b(?:arrive|arrival|ankunft|ETA)\\b.*"))road=text;
  }
  return new Result(step,remaining,seconds,explicit==null?modelIcon:explicit.icon,explicit==null?modelScore:1f,explicit!=null,road,estimated,immediate,explicit!=null&&explicit.departure);
 }
 private static Integer bounded(Double value){return value!=null&&Double.isFinite(value)&&value>=0&&value<=Integer.MAX_VALUE?(int)Math.round(value):null;}
 static String clean(String value){return value==null?"":value.replace('\u00a0',' ').replaceAll("[\\s\\u200e\\u200f]+"," ").trim();}
 private static Turn turn(String value){
  Matcher depart=Pattern.compile("(?iu)^(?:(?:head|start|proceed) (?:towards?|in the direction of)|(?:starte|fahre|fahren sie) (?:in )?richtung) +(.+)$").matcher(value);
  if(depart.matches())return new Turn(9,"onto "+depart.group(1),true);
  Matcher heading=Pattern.compile("(?iu)^head (?:north|south|east|west|northeast|northwest|southeast|southwest|north-east|north-west|south-east|south-west)(?: (?:towards?|on|onto) (.+))?$").matcher(value);
  if(heading.matches())return new Turn(9,heading.group(1)==null?"":"onto "+heading.group(1),true);
  Matcher onward=Pattern.compile("(?iu)^(?:continue (?:on|onto)|weiter auf) +(.+)$").matcher(value);
  if(onward.matches())return new Turn(9,"onto "+onward.group(1));
  String[] patterns={
   "(?:make (?:a )?u[- ]turn|u[- ]turn|bitte wenden|wenden)\\b",
   "(?:(?:turn )?(?:slightly|slight) left|bear left|keep left|links halten|halte dich links|leicht links(?: abbiegen)?)\\b",
   "(?:(?:turn )?(?:slightly|slight) right|bear right|keep right|rechts halten|halte dich rechts|leicht rechts(?: abbiegen)?)\\b",
   "(?:(?:turn )?(?:sharply|sharp) left|scharf links(?: abbiegen)?)\\b",
   "(?:(?:turn )?(?:sharply|sharp) right|scharf rechts(?: abbiegen)?)\\b",
   "(?:turn left|links abbiegen)\\b", "(?:turn right|rechts abbiegen)\\b",
   "(?:continue straight(?: ahead)?|go straight(?: ahead)?|straight ahead|geradeaus(?: weiter(?:fahren)?)?)\\b",
   "(?:you have arrived(?: at your destination)?|you've arrived(?: at your destination)?|ziel erreicht)\\b"};
  int[] icons={8,4,5,6,7,2,3,9,15};
  for(int i=0;i<patterns.length;i++){Matcher m=Pattern.compile("(?iu)^"+patterns[i]).matcher(value);if(m.find())return new Turn(icons[i],value.substring(m.end()).trim());}return null;
 }
 private static boolean hasInstruction(String value){Matcher prefix=PREFIX.matcher(value);String instruction=prefix.find()?value.substring(prefix.end()).replaceFirst("^[\\s·•:–—-]+","").trim():value;return turn(instruction)!=null;}
 private static String road(String rest){Matcher m=Pattern.compile("(?iu)^(?:onto|on|auf(?: die| den| der)?|in(?: die| den| der)?)\\s+(.+)$").matcher(rest);return m.find()?m.group(1).trim():"";}
 private MapsNotification(){}
}
