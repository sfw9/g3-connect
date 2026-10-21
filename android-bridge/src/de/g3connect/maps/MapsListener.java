package de.g3connect.maps;
import android.app.Notification;
import android.service.notification.*;
import android.os.*;
import java.util.*;
import org.json.JSONObject;
/** Reads Google Maps only. No server, network, Chrome or second application is involved. */
public final class MapsListener extends NotificationListenerService {
 private IconModel classifier;private final Handler handler=new Handler(Looper.getMainLooper());private long removedAt;private String routeKey;
 private final Runnable poll=new Runnable(){public void run(){if(!MapsState.listenerReady)return;refresh();handler.postDelayed(this,1000);}};
 @Override public void onListenerConnected(){MapsState.listenerReady=true;closeModel();try{classifier=new IconModel(this);}catch(Exception ignored){MapsState.clear("Pfeilmodell konnte nicht geladen werden.");}handler.removeCallbacks(poll);handler.post(poll);}
 @Override public void onListenerDisconnected(){MapsState.listenerReady=false;handler.removeCallbacks(poll);MapsState.clear("Benachrichtigungszugriff getrennt.");closeModel();}
 @Override public void onDestroy(){MapsState.listenerReady=false;handler.removeCallbacksAndMessages(null);MapsState.clear("Maps-Dienst beendet.");closeModel();super.onDestroy();}
 private void closeModel(){if(classifier!=null){classifier.close();classifier=null;}}
 @Override public void onNotificationPosted(StatusBarNotification n){if(!"com.google.android.apps.maps".equals(n.getPackageName()))return;handler.post(()->refresh());}
 @Override public void onNotificationRemoved(StatusBarNotification n){if(!"com.google.android.apps.maps".equals(n.getPackageName()))return;if(n.getKey().equals(routeKey)){removedAt=System.currentTimeMillis();handler.postDelayed(()->refresh(),1250);}}
 private void refresh(){try{StatusBarNotification[] list=getActiveNotifications();StatusBarNotification best=null,fallback=null;
   if(list!=null)for(StatusBarNotification n:list){if(!"com.google.android.apps.maps".equals(n.getPackageName()))continue;Notification note=n.getNotification();if((note.flags&Notification.FLAG_ONGOING_EVENT)==0)continue;
    if(fallback==null||n.getPostTime()>fallback.getPostTime())fallback=n;
    boolean isRoute=n.getKey().equals(routeKey)||MapsNotification.parse(fields(note.extras),-1,0).candidate();
    if(isRoute&&(best==null||n.getPostTime()>best.getPostTime()))best=n;
   }
   if(best==null&&fallback!=null&&routeKey==null)best=fallback;
   if(best==null){if(fallback!=null){Notification pending=fallback.getNotification();Map<String,String> raw=fields(pending.extras);MapsNotification.Result parsed=MapsNotification.parse(raw,-1,0);diagnostic(pending,raw,parsed,new IconModel.Result(-1,0));}if(removedAt==0||System.currentTimeMillis()-removedAt>=1200){routeKey=null;MapsState.clear("Google-Maps-Navigation beendet oder noch nicht gestartet.");}return;}
   removedAt=0;Notification note=best.getNotification();Bundle e=note.extras;
   if(MapsNotification.parse(fields(e),-1,0).candidate())routeKey=best.getKey();
   Map<String,String> fields=fields(e);
   IconModel.Result model=classifier==null?new IconModel.Result(-1,0):classifier.classify(this,note.getLargeIcon());
   MapsNotification.Result result=MapsNotification.parse(fields,model.icon,model.score);
   diagnostic(note,fields,result,model);
   MapsState.current=result.sample(System.currentTimeMillis());MapsState.status=result.status();

  }catch(Exception e){MapsState.clear("Maps-Benachrichtigungen können nicht gelesen werden.");}}
 private static Map<String,String> fields(Bundle extras){Map<String,String> out=new LinkedHashMap<>();if(extras==null)return out;
  for(String key:MapsNotification.FIELDS){CharSequence value;
   if(MapsNotification.LINES.equals(key)){CharSequence[] lines=extras.getCharSequenceArray(key);StringBuilder text=new StringBuilder();if(lines!=null)for(CharSequence line:lines)if(line!=null){if(text.length()>0)text.append('\n');text.append(line);}value=text;}
   else value=extras.getCharSequence(key);
   if(value!=null){String text=value.toString();out.put(key,text.substring(0,Math.min(text.length(),2048)));}
  }return out;
 }
 private void diagnostic(Notification note,Map<String,String> fields,MapsNotification.Result result,IconModel.Result model){try{JSONObject report=new JSONObject();report.put("app","G3 Connect Android 1.0");report.put("package","com.google.android.apps.maps");report.put("capturedAt",System.currentTimeMillis());report.put("textFields",new JSONObject(fields));report.put("largeIconPresent",note.getLargeIcon()!=null);report.put("customLayout",note.contentView!=null);report.put("customBigLayout",note.bigContentView!=null);report.put("modelIcon",model.icon);report.put("modelScore",model.score);report.put("modelInputMode",model.inputMode);report.put("modelForegroundPixels",model.foregroundPixels);report.put("directionSource",result.departure?"departureInstruction":result.textDirection?"instructionText":"iconModel");report.put("parsedIcon",result.icon);report.put("stepMeters",result.step==null?JSONObject.NULL:result.step);report.put("stepSource",result.step==null?"unknown":result.stepImmediate?"immediateInstruction":"mapsDistance");report.put("parsedRoad",result.road);report.put("remainingMeters",result.remaining==null?JSONObject.NULL:result.remaining);report.put("remainingSeconds",result.seconds==null?JSONObject.NULL:result.seconds);report.put("remainingSecondsSource",result.seconds==null?"unknown":result.secondsEstimated?"arrivalClockEstimate":"relativeDuration");report.put("timeZone",TimeZone.getDefault().getID());report.put("displayRemainingMeters",result.displayRemaining());report.put("displayRemainingSource",result.distancePlaceholder()?"fixed1337kmPlaceholder":"maps");report.put("displayEligible",result.sample(System.currentTimeMillis())!=null);MapsState.diagnostic=report.toString(2);}catch(Exception ignored){}}
}
