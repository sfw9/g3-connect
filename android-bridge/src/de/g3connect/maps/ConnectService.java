package de.g3connect.maps;
import android.app.*;
import android.bluetooth.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import android.util.Base64;
import java.util.concurrent.*;
import java.text.SimpleDateFormat;
import java.util.*;
/** User-started connected-device foreground service; stays active while Maps is in front. */
public final class ConnectService extends Service {
 static volatile ConnectService instance;static volatile String status="Nicht verbunden.";static volatile boolean connected,armed=true,manualActive;static volatile String manualStatus="Manuelles Senden aus.";
 private static final StringBuilder LOG=new StringBuilder();
 static synchronized void log(String value){String clean=value.replaceAll("(?i)[0-9a-f]{32,}","[entfernt]");LOG.append(new SimpleDateFormat("HH:mm:ss.SSS",Locale.ROOT).format(new Date())).append(" ").append(clean).append('\n');if(LOG.length()>28000)LOG.delete(0,LOG.indexOf("\n",LOG.length()-24000)+1);}
 static synchronized String logs(){return LOG.toString();}
 static void arm(boolean value){if(armed==value)return;armed=value;log("Maps-Automatik "+(value?"ein":"aus"));ConnectService current=instance;if(value&&current!=null)current.useMaps();}
 private final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor();private final Handler main=new Handler(Looper.getMainLooper());
 private volatile BleWire wire;private volatile NinebotClient client;private NavigationLoop navigation;private final ManualSender manual=new ManualSender();private volatile boolean closing;private boolean connecting;private long testUntil,wakeRenewAt;private String lastMapsStatus="";
 private PowerManager.WakeLock wake;
 @Override public void onCreate(){super.onCreate();instance=this;NotificationManager manager=getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel("g3-connection","G3-Verbindung",NotificationManager.IMPORTANCE_LOW));
  PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  Intent quit=new Intent(this,ConnectService.class).setAction("disconnect");PendingIntent stop=PendingIntent.getService(this,1,quit,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  Notification note=new Notification.Builder(this,"g3-connection").setSmallIcon(android.R.drawable.stat_sys_data_bluetooth).setContentTitle("G3 Connect").setContentText("Bluetooth aktiv · Maps-Hinweise werden lokal übertragen").setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(null,"Trennen",stop).build()).build();
  if(Build.VERSION.SDK_INT>=29)startForeground(11,note,ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);else startForeground(11,note);
  wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"g3connect:navigation");wake.setReferenceCounted(false);
  worker.scheduleWithFixedDelay(()->tick(),1000,1000,TimeUnit.MILLISECONDS);
 }
 @Override public int onStartCommand(Intent intent,int flags,int id){if(intent==null){stopSelf();return START_NOT_STICKY;}String action=intent.getAction();if("disconnect".equals(action)){disconnect();return START_NOT_STICKY;}if("connect".equals(action)&&!connecting&&!connected&&!closing){connecting=true;String address=intent.getStringExtra("address"),name=intent.getStringExtra("name");boolean force=intent.getBooleanExtra("force",false);worker.execute(()->connect(address,name,force));}return START_NOT_STICKY;}
 private void connect(String address,String name,boolean force){try{
   getSharedPreferences("g3",MODE_PRIVATE).edit().putString("device",address).putString("name",name).apply();String stored=getSharedPreferences("g3",MODE_PRIVATE).getString("pair:"+address,null);byte[] key=force||stored==null?null:Base64.decode(stored,Base64.NO_WRAP);
   try{open(address,name,key);}catch(Exception first){if(key==null||closing)throw first;log("Gespeicherte Kopplung fehlgeschlagen. Frische GATT-Sitzung für Power-Kopplung.");if(wire!=null)wire.close();open(address,name,null);}
   if(closing)return;connected=true;status="Verbunden · Maps-Automatik "+(armed?"bereit":"aus");log(status);
   final NinebotClient session=client;navigation=new NavigationLoop(new NavigationLoop.Display(){public void start()throws Exception{session.startNavigation();}public void update(MapsState.Sample s,int total)throws Exception{session.guidance(s,total);}public void stop()throws Exception{session.stopNavigation();}});
  }catch(Exception e){if(!closing){status="Verbindung fehlgeschlagen: "+message(e);log(status);}finish();}finally{connecting=false;}}
 private void open(String address,String name,byte[] key)throws Exception{if(closing)throw new InterruptedException();BluetoothAdapter adapter=((BluetoothManager)getSystemService(BLUETOOTH_SERVICE)).getAdapter();if(adapter==null||!adapter.isEnabled())throw new IllegalStateException("Bluetooth einschalten.");status="GATT verbinden …";log(status);wire=new BleWire(this,adapter.getRemoteDevice(address));if(closing){wire.close();throw new InterruptedException();}wire.open();log("GATT bereit · Nordic UART · MTU ausgehandelt.");client=new NinebotClient(wire,s->{if(!s.startsWith("TX ")&&!s.startsWith("RX "))status=s;log(s);});client.authenticate(name,key,password->{if(!closing)getSharedPreferences("g3",MODE_PRIVATE).edit().putString("pair:"+address,Base64.encodeToString(password,Base64.NO_WRAP)).apply();});}
 private void tick(){if(closing||!connected||client==null||navigation==null)return;try{client.pump();long now=System.currentTimeMillis();
   if(manual.active()){manual.tick(navigation,now,SystemClock.elapsedRealtime());manualActive=manual.active();manualStatus=manual.status(SystemClock.elapsedRealtime());if(!manualActive)log("Manuelles Senden nach Laufzeit beendet.");}
   else if(testUntil!=0){if(now>=testUntil){testUntil=0;navigation.stop();log("Displaytest nach 15 Sekunden beendet.");}else navigation.tick(true,true,new MapsState.Sample(100,300,120,2,1,"Displaytest",now),now);}
   else navigation.tick(armed,MapsState.listenerReady,MapsState.current,now);
   if(armed&&!manual.active()&&MapsState.current==null&&!MapsState.status.equals(lastMapsStatus)){lastMapsStatus=MapsState.status;log(lastMapsStatus);}
   boolean active=navigation.active();status=manualActive?manualStatus:active?"Navigation ans G3 aktiv.":!armed?"Verbunden · Maps-Automatik aus.":"Verbunden · wartet auf vollständige Maps-Navigation.";
   if(active){if(!wake.isHeld()||now-wakeRenewAt>=60000){wake.acquire(10*60*1000L);wakeRenewAt=now;}}else if(wake.isHeld())wake.release();
  }catch(Exception e){log("Navigation angehalten: "+message(e));status="Angehalten: "+message(e);try{navigation.stop();}catch(Exception ignored){}finish();}}
 void displayTest(){if(!connected||closing){log("Zuerst verbinden.");return;}worker.execute(()->{try{if(closing)return;client.stationary();manual.clear();manualActive=false;manualStatus=manual.status(0);navigation.stop();testUntil=System.currentTimeMillis()+15000;log("Synthetischer Displaytest: Linkspfeil, 100 m, 15 Sekunden.");}catch(Exception e){log("Displaytest fehlgeschlagen: "+message(e));}});}
 void stopNavigation(){armed=false;worker.execute(()->{testUntil=0;manual.clear();manualActive=false;manualStatus=manual.status(0);try{if(navigation!=null)navigation.stop();}catch(Exception e){log("Navigationsstopp nicht bestätigt: "+message(e));}});}
 void startManual(ManualSender.Config config){
  if(!connected||closing){log("Zuerst verbinden.");return;}
  arm(false);
  worker.execute(()->{if(closing)return;try{testUntil=0;manual.stop(navigation);manual.start(config,SystemClock.elapsedRealtime());manual.tick(navigation,System.currentTimeMillis(),SystemClock.elapsedRealtime());manualActive=true;manualStatus=manual.status(SystemClock.elapsedRealtime());status=manualStatus;log("Manueller Datensatz gestartet · "+(config.repeat?"Dauersenden":"einmal")+" · Sendedauer "+config.duration+" s.");}catch(Exception e){manual.clear();manualActive=false;manualStatus="Manuelles Senden fehlgeschlagen: "+message(e);log(manualStatus);try{navigation.stop();}catch(Exception ignored){}finish();}});
 }
 void stopManual(){if(closing)return;worker.execute(()->{if(!manual.active())return;try{manual.stop(navigation);manualActive=false;manualStatus=manual.status(0);status=manualStatus;log("Manuelles Senden gestoppt.");}catch(Exception e){log("Manueller Stopp nicht bestätigt: "+message(e));finish();}});}
 private void useMaps(){if(closing)return;worker.execute(()->{if(!manual.active())return;try{manual.stop(navigation);manualActive=false;manualStatus=manual.status(0);log("Manuelles Senden beendet; Maps-Automatik übernimmt.");}catch(Exception e){log("Moduswechsel fehlgeschlagen: "+message(e));finish();}});}
 interface Job {void run(NinebotClient client)throws Exception;}
 void command(Job job){if(!connected||closing){log("Zuerst verbinden.");return;}worker.execute(()->{if(closing)return;try{job.run(client);}catch(Exception e){log("Einstellung fehlgeschlagen: "+message(e));}});}
 void disconnect(){if(closing)return;closing=true;if(!connected){if(wire!=null)wire.close();finish();return;}main.postDelayed(()->finish(),4500);worker.execute(()->{try{if(navigation!=null)navigation.stop();}catch(Exception e){log("Navigationsstopp nicht bestätigt: "+message(e));}finally{finish();}});}
 private void finish(){closing=true;connected=false;manualActive=false;manualStatus="Manuelles Senden aus · Verbindung beendet.";BleWire w=wire;if(w!=null)w.close();if(wake!=null&&wake.isHeld())wake.release();main.post(()->{stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();});}
 static String message(Exception e){if(e instanceof SecurityException)return "Bluetooth-Berechtigung fehlt.";String m=e.getMessage();return m==null?e.getClass().getSimpleName():m;}
 @Override public void onDestroy(){closing=true;connected=false;manualActive=false;manualStatus="Manuelles Senden aus · Verbindung beendet.";if(wire!=null)wire.close();worker.shutdownNow();if(wake!=null&&wake.isHeld())wake.release();main.removeCallbacksAndMessages(null);instance=null;if(!status.startsWith("Verbindung fehlgeschlagen")&&!status.startsWith("Angehalten"))status="Nicht verbunden.";log("Verbindung beendet.");super.onDestroy();}
 @Override public IBinder onBind(Intent intent){return null;}
}
