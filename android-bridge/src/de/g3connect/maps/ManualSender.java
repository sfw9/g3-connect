package de.g3connect.maps;
import java.math.BigDecimal;
import java.math.RoundingMode;
/** Explicit user-controlled TFT data. Its runtime uses a monotonic clock, independent of Maps and wall-clock changes. */
final class ManualSender {
 static final class Config {
  final int icon,step,remaining,seconds,duration;final String road;final boolean repeat,countdown;
  Config(int icon,String road,int step,int remaining,int seconds,int duration,boolean repeat,boolean countdown){
   MapsState.Sample probe=new MapsState.Sample(step,remaining,seconds,icon,1,road,0);
   if(!probe.valid())throw new IllegalArgumentException("Richtung, Entfernungen oder Restzeit ungültig. Reststrecke muss mindestens der Abbiegedistanz entsprechen.");
   if(duration<0||duration>86400)throw new IllegalArgumentException("Sendedauer: 0 bis 86400 Sekunden.");
   this.icon=icon;this.road=road==null?"":road.replace('\u0000',' ').trim();this.step=step;this.remaining=remaining;this.seconds=seconds;this.duration=duration;this.repeat=repeat;this.countdown=countdown;
  }
  static Config parse(int icon,String road,String step,String remainingKm,String minutes,String duration,boolean repeat,boolean countdown){
   return new Config(icon,road,integer(step,Integer.MAX_VALUE,"Abbiegedistanz"),decimal(remainingKm,1000,"Reststrecke"),decimal(minutes,60,"Restfahrzeit"),integer(duration,86400,"Sendedauer"),repeat,countdown);
  }
  private static int integer(String value,int limit,String field){try{String clean=value.trim();if(!clean.matches("[0-9]{1,10}"))throw new NumberFormatException();long n=Long.parseLong(clean);if(n>limit)throw new NumberFormatException();return(int)n;}catch(Exception e){throw new IllegalArgumentException(field+": eine ganze Zahl von 0 bis "+limit+" eingeben.");}}
  private static int decimal(String value,int multiplier,String field){try{String clean=value.trim().replace(',','.');if(!clean.matches("[0-9]+(?:\\.[0-9]{1,3})?"))throw new NumberFormatException();return new BigDecimal(clean).multiply(BigDecimal.valueOf(multiplier)).setScale(0,RoundingMode.HALF_UP).intValueExact();}catch(Exception e){throw new IllegalArgumentException(field+": gültige positive Zahl oder 0 eingeben.");}}
 }
 private Config config;private long started,lastSent;private boolean sent;
 boolean active(){return config!=null;}
 void start(Config config,long elapsed){if(config==null)throw new IllegalArgumentException();this.config=config;this.started=elapsed;this.sent=false;}
 void clear(){config=null;sent=false;}
 void stop(NavigationLoop navigation)throws Exception{clear();navigation.stop();}
 void tick(NavigationLoop navigation,long wallTime,long elapsed)throws Exception{
  Config c=config;if(c==null)return;long age=Math.max(0,elapsed-started);
  if(c.duration>0&&age>=c.duration*1000L){stop(navigation);return;}
  if(sent&&(!c.repeat||elapsed-lastSent<1000))return;
  int seconds=c.countdown?(int)Math.max(0,c.seconds-age/1000L):c.seconds;
  MapsState.Sample sample=new MapsState.Sample(c.step,c.remaining,seconds,c.icon,1,c.road,wallTime,false,c.road);
  navigation.tick(true,true,sample,wallTime);sent=true;lastSent=elapsed;
 }
 String status(long elapsed){Config c=config;if(c==null)return "Manuelles Senden aus.";String time=c.duration==0?"bis Stopp":Math.max(0,c.duration-(Math.max(0,elapsed-started)/1000))+" s verbleibend";return "Manuell: "+(c.repeat?"Dauersenden (ca. 1×/s)":"Einmal gesendet")+" · "+time;}
}
