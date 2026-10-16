package de.g3connect.maps;
import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.text.InputType;
import android.text.InputFilter;
import android.bluetooth.*;
import android.bluetooth.le.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import android.provider.Settings;
import android.widget.*;
import java.util.*;
public final class MainActivity extends Activity {
 private TextView status,log,manualState;private CheckBox automatic;private LinearLayout devices;private BluetoothLeScanner scanner;private boolean scanning;private final Set<String> seen=new HashSet<>();private final Handler handler=new Handler(Looper.getMainLooper());
 private final Runnable refresh=new Runnable(){public void run(){if(automatic.isChecked()!=ConnectService.armed)automatic.setChecked(ConnectService.armed);manualState.setText(ConnectService.manualStatus);status.setText(ConnectService.status+"\n"+(ConnectService.manualActive?"Manuelles Senden funktioniert ohne Maps-Zugriff.":MapsState.listenerReady?"Benachrichtigungszugriff aktiv.":"Benachrichtigungszugriff noch nicht aktiv.")+"\n"+(ConnectService.manualActive?"Manueller Modus · Maps pausiert.":MapsState.status));log.setText(ConnectService.logs());handler.postDelayed(this,1000);}};
 private final ScanCallback scan=new ScanCallback(){@Override public void onScanResult(int type,ScanResult result){runOnUiThread(()->found(result));}@Override public void onScanFailed(int code){runOnUiThread(()->{scanning=false;notice("Bluetooth-Suche fehlgeschlagen: "+code);});}};
 @Override public void onCreate(Bundle saved){super.onCreate(saved);LinearLayout column=new LinearLayout(this);column.setOrientation(1);int pad=(int)(16*getResources().getDisplayMetrics().density);column.setPadding(pad,pad,pad,pad);column.setOnApplyWindowInsetsListener((view,insets)->{view.setPadding(pad+insets.getSystemWindowInsetLeft(),pad+insets.getSystemWindowInsetTop(),pad+insets.getSystemWindowInsetRight(),pad+insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});ScrollView scroll=new ScrollView(this);scroll.addView(column);setContentView(scroll);
  TextView title=new TextView(this);title.setText("G3 Connect · Android Beta 16");title.setTextSize(22);column.addView(title);
  text(column,"Roller verbinden, Zugriff erlauben, dann in Google Maps eine Navigation starten. G3 Connect überträgt die Hinweise im Hintergrund direkt ans Display. Kein API-Schlüssel und keine zusätzliche Brücken-App nötig. Vor dem Losfahren verbinden und auf den ersten Pfeil warten.");
  button(column,"1. Benachrichtigungszugriff erlauben",()->startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
  button(column,"2. Bluetooth-Berechtigung erlauben",()->permissions());
  button(column,"Roller suchen",()->search());devices=new LinearLayout(this);devices.setOrientation(1);column.addView(devices);
  button(column,"Mit letztem Roller verbinden",()->last(false));button(column,"Neu koppeln (Power-Taste)",()->last(true));button(column,"Verbindung trennen",()->{ConnectService s=ConnectService.instance;if(s!=null)s.disconnect();});
  automatic=new CheckBox(this);automatic.setText("Google Maps automatisch am G3 starten / beenden");automatic.setChecked(ConnectService.armed);automatic.setOnCheckedChangeListener((v,checked)->ConnectService.arm(checked));column.addView(automatic);
  button(column,"3. Google Maps öffnen",()->{Intent i=getPackageManager().getLaunchIntentForPackage("com.google.android.apps.maps");if(i==null)notice("Google Maps ist nicht installiert.");else startActivity(i);});
  button(column,"Manuell senden / Dauersenden …",()->manualDialog());
  button(column,"Manuelles Senden stoppen",()->{ConnectService service=ConnectService.instance;if(service!=null)service.stopManual();});
  manualState=text(column,ConnectService.manualStatus);
  button(column,"Displaytest · Linkspfeil / 100 m / 15 s",()->{ConnectService s=ConnectService.instance;if(s==null)notice("Zuerst verbinden.");else s.displayTest();});
  button(column,"Navigation stoppen / Automatik aus",()->{automatic.setChecked(false);ConnectService s=ConnectService.instance;if(s!=null)s.stopNavigation();});
  button(column,"Maps-Diagnose kopieren",()->{((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("G3 Connect Maps-Diagnose",MapsState.diagnostic));notice("Maps-Diagnose kopiert. Enthält den aktuellen Maps-Text und Straßennamen.");});
  text(column,"Bei fehlenden Pfeilen zeigt die Maps-Diagnose, welche Angaben Android liefert. Sie enthält den Maps-Navigationstext einschließlich Straßennamen; andere Apps und Bluetooth-Schlüssel werden nicht erfasst.");
  text(column,"Fehlt die Gesamt-Reststrecke in Maps, sendet die App 1337 km als festen Platzhalter. Abbiegedistanz und Richtung kommen weiterhin aus Maps.");
  status=text(column,"");text(column,"Einstellungen · nur im Stillstand");
  for(int i=1;i<=3;i++){final int level=i;button(column,"Beschleunigung "+i,()->command(c->c.acceleration(level)));}
  button(column,"Reichweitenanzeige ein",()->command(c->c.range(true)));button(column,"Reichweitenanzeige aus",()->command(c->c.range(false)));
  button(column,"Einstellungen lesen",()->command(c->{ConnectService.log("Beschleunigung: "+c.read(0x6e)+" · Reichweitenanzeige: "+((c.read(0x2f)&0x10)!=0?"ein":"aus"));}));
  text(column,"Verbindungsprotokoll");button(column,"Log kopieren",()->{((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("G3 Connect Log",ConnectService.logs()));notice("Log kopiert.");});
  log=text(column,"");log.setTextIsSelectable(true);text(column,"Android 13+: Falls der Benachrichtigungszugriff gesperrt ist, in den Android-App-Infos ‚Eingeschränkte Einstellungen zulassen‘ aktivieren. Bei Bedarf G3 Connect von der Akkuoptimierung ausnehmen. Andere Bluetooth-Apps vor dem Verbinden schließen.\n\nBeta: Google-Maps-Formate und Pfeilerkennung können je nach Version abweichen. Nicht erkennbare Hinweise stoppen die Übertragung. Die G3-Pakete sind am Roller bestätigt; Bluetooth und Maps-Erfassung wurden auf Android 16 bestätigt; neue Display-Funktionen am Roller prüfen.\n\nAndere App-Benachrichtigungen werden vor dem Lesen gefiltert. Kopplungsschlüssel bleiben im privaten App-Speicher. Keine Firmware-Updates. Modell: OpenDash / KTM-Nav-GEN3 (MIT); TensorFlow Lite (Apache 2.0). Lizenzen sind im APK und im Quellcode enthalten.");
  ConnectService.log("G3 Connect Android Beta 16 geöffnet · Android "+Build.VERSION.RELEASE);
 }
 private void manualDialog(){
  LinearLayout form=new LinearLayout(this);form.setOrientation(1);int pad=(int)(16*getResources().getDisplayMetrics().density);form.setPadding(pad,pad,pad,pad);ScrollView scroll=new ScrollView(this);scroll.addView(form);
  android.content.SharedPreferences preferences=getSharedPreferences("g3",MODE_PRIVATE);
  text(form,"Richtung");Spinner direction=new Spinner(this);String[] names={"Vorwärts / geradeaus","Links","Rechts","Leicht links","Leicht rechts","Scharf links","Scharf rechts","Wenden","Kreisverkehr rechts","Kreisverkehr links","Ziel erreicht"};int[] icons={9,2,3,4,5,6,7,8,11,12,15};ArrayAdapter<String> options=new ArrayAdapter<>(this,android.R.layout.simple_spinner_item,names);options.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);direction.setAdapter(options);direction.setSelection(Math.min(names.length-1,Math.max(0,preferences.getInt("manualDirection",1))));form.addView(direction);
  EditText road=manualField(form,"Straße",preferences.getString("manualRoad","TESTSTRASSE"),InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_WORDS);
  EditText step=manualField(form,"Entfernung bis zum Abbiegen (m)",preferences.getString("manualStep","100"),InputType.TYPE_CLASS_NUMBER);
  EditText minutes=manualField(form,"Restfahrzeit (Minuten)",preferences.getString("manualMinutes","5"),InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);
  EditText remaining=manualField(form,"Reststrecke (km)",preferences.getString("manualRemaining","1337"),InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);
  EditText duration=manualField(form,"Sendedauer (Sekunden, 0 = bis Stopp)",preferences.getString("manualDuration","0"),InputType.TYPE_CLASS_NUMBER);
  CheckBox countdown=new CheckBox(this);countdown.setText("Restfahrzeit herunterzählen");countdown.setChecked(preferences.getBoolean("manualCountdown",false));form.addView(countdown);
  text(form,"Ohne Google Maps oder Benachrichtigungszugriff nutzbar. Dauersenden wiederholt ungefähr jede Sekunde. Die Vorgaben ersetzen vorübergehend die Maps-Navigation. Nach dem Stopp kannst du die Maps-Automatik wieder einschalten.");TextView error=text(form,"");
  AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Manuelle Display-Navigation").setView(scroll).setPositiveButton("Dauersenden",null).setNeutralButton("Einmal",null).setNegativeButton("Abbrechen",null).create();
  dialog.setOnShowListener(shown->{for(int which:new int[]{AlertDialog.BUTTON_POSITIVE,AlertDialog.BUTTON_NEUTRAL}){final boolean repeat=which==AlertDialog.BUTTON_POSITIVE;dialog.getButton(which).setOnClickListener(v->{try{
    ConnectService service=ConnectService.instance;if(service==null||!ConnectService.connected)throw new IllegalArgumentException("Zuerst mit dem Roller verbinden.");
    ManualSender.Config config=ManualSender.Config.parse(icons[direction.getSelectedItemPosition()],road.getText().toString(),step.getText().toString(),remaining.getText().toString(),minutes.getText().toString(),duration.getText().toString(),repeat,countdown.isChecked());
    preferences.edit().putInt("manualDirection",direction.getSelectedItemPosition()).putString("manualRoad",road.getText().toString()).putString("manualStep",step.getText().toString()).putString("manualMinutes",minutes.getText().toString()).putString("manualRemaining",remaining.getText().toString()).putString("manualDuration",duration.getText().toString()).putBoolean("manualCountdown",countdown.isChecked()).apply();
    service.startManual(config);automatic.setChecked(false);dialog.dismiss();
   }catch(Exception e){error.setText(ConnectService.message(e));}});}});dialog.show();
 }
 private EditText manualField(LinearLayout parent,String label,String value,int type){text(parent,label);EditText edit=new EditText(this);edit.setInputType(type);edit.setSingleLine(true);edit.setFilters(new InputFilter[]{new InputFilter.LengthFilter(200)});edit.setText(value);edit.setContentDescription(label);parent.addView(edit);return edit;}
 private void command(ConnectService.Job job){ConnectService s=ConnectService.instance;if(s==null)notice("Zuerst Roller verbinden.");else s.command(job);}
 private void permissions(){List<String> names=new ArrayList<>();if(Build.VERSION.SDK_INT>=31){names.add(Manifest.permission.BLUETOOTH_SCAN);names.add(Manifest.permission.BLUETOOTH_CONNECT);}else names.add(Manifest.permission.ACCESS_FINE_LOCATION);if(Build.VERSION.SDK_INT>=33)names.add(Manifest.permission.POST_NOTIFICATIONS);requestPermissions(names.toArray(new String[0]),1);}
 private boolean allowed(){return Build.VERSION.SDK_INT>=31?checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)==PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED:checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;}
 private void search(){if(!allowed()){permissions();notice("Berechtigung erlauben und Suche erneut starten.");return;}stopScan();try{BluetoothAdapter a=((BluetoothManager)getSystemService(BLUETOOTH_SERVICE)).getAdapter();if(a==null||!a.isEnabled()){notice("Bluetooth einschalten.");return;}scanner=a.getBluetoothLeScanner();devices.removeAllViews();seen.clear();scanning=true;
   // No filter: some G3 advertisements omit service UUIDs. Only recognizable Ninebot devices enter the list.
   scanner.startScan(null,new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),scan);handler.postDelayed(()->{stopScan();if(seen.isEmpty())notice("Kein G3 gefunden. Roller einschalten; auf Android 8–11 auch Standort einschalten.");},10000);
  }catch(Exception e){notice(ConnectService.message(e));}}
 private void found(ScanResult r){if(!scanning||r.getScanRecord()==null)return;String name=r.getScanRecord().getDeviceName();if(name==null)name=r.getDevice().getName();if(name==null||!name.startsWith("1C"))return;String address=r.getDevice().getAddress();if(!seen.add(address))return;final String fullName=name;button(devices,"G3 verbinden · Gerät "+seen.size()+" · "+r.getRssi()+" dBm",()->connect(address,fullName,false));}
 private void last(boolean force){String a=getSharedPreferences("g3",MODE_PRIVATE).getString("device",null),n=getSharedPreferences("g3",MODE_PRIVATE).getString("name",null);if(a==null||n==null){notice("Zuerst Roller suchen und auswählen.");return;}connect(a,n,force);}
 private void connect(String address,String name,boolean force){if(!allowed()){permissions();return;}stopScan();if(ConnectService.instance!=null){notice("Vor einem neuen Verbindungsversuch zuerst trennen.");return;}Intent i=new Intent(this,ConnectService.class).setAction("connect").putExtra("address",address).putExtra("name",name).putExtra("force",force);try{startForegroundService(i);}catch(Exception e){notice(ConnectService.message(e));}}
 private void stopScan(){if(scanner!=null&&scanning)try{scanner.stopScan(scan);}catch(Exception ignored){}scanning=false;}
 private TextView text(LinearLayout parent,String value){TextView t=new TextView(this);t.setText(value);t.setPadding(0,8,0,8);parent.addView(t);return t;}
 private void button(LinearLayout parent,String value,Runnable action){Button b=new Button(this);b.setText(value);b.setOnClickListener(v->action.run());parent.addView(b);}
 private void notice(String text){Toast.makeText(this,text,Toast.LENGTH_LONG).show();ConnectService.log(text);}
 @Override public void onResume(){super.onResume();handler.removeCallbacks(refresh);handler.post(refresh);}
 @Override public void onPause(){stopScan();handler.removeCallbacks(refresh);super.onPause();}
}
