package de.g3connect.maps;
import java.util.*;
import java.util.regex.*;
/** Minute-resolution arrival clock minus the phone's current local time. */
final class ArrivalTime {
 private static final Pattern CLOCK=Pattern.compile("(?iu)(?:^|[·•])\\s*(?:arrive(?: at)?|arrival(?: at)?|ankunft(?: um)?|eta)\\s*:?\\s*(\\d{1,2})[:.](\\d{2})\\s*(am|pm|a\\.m\\.|p\\.m\\.)?(?=$|[\\s·•])");
 static Integer seconds(String text,long now,TimeZone zone){
  if(text==null||zone==null)return null;Matcher m=CLOCK.matcher(MapsNotification.clean(text));if(!m.find())return null;
  int hour=Integer.parseInt(m.group(1)),minute=Integer.parseInt(m.group(2));String ampm=m.group(3);
  if(minute>59)return null;if(ampm!=null){if(hour<1||hour>12)return null;hour=hour%12+(ampm.toLowerCase(Locale.ROOT).startsWith("p")?12:0);}else if(hour>23)return null;
  Calendar arrival=Calendar.getInstance(zone);arrival.setTimeInMillis(now);arrival.setLenient(false);arrival.set(Calendar.HOUR_OF_DAY,hour);arrival.set(Calendar.MINUTE,minute);arrival.set(Calendar.SECOND,0);arrival.set(Calendar.MILLISECOND,0);
  try{long delta=arrival.getTimeInMillis()-now;
   // Maps publishes only HH:mm: the current arrival minute is approximately zero, not tomorrow.
   if(delta<0&&delta>-60000)return 0;
   if(delta<0){arrival.add(Calendar.DAY_OF_MONTH,1);delta=arrival.getTimeInMillis()-now;}
   // A stale ETA from a minute ago must not become a nearly 24-hour route. No date is supplied.
   if(delta<0||delta>12L*60*60*1000)return null;
   return (int)((delta+999)/1000);
  }catch(IllegalArgumentException invalidLocalTime){return null;}
 }
 private ArrivalTime(){}
}
