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
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.*;
import android.os.*;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.*;
import android.widget.*;
import java.util.*;
public final class MainActivity extends Activity {
 /** Last values confirmed by the scooter in this connection; 0 / -1 = unknown. */
 static volatile int knownLevel,knownRange=-1;static volatile String settingsNote="";
 private static final int PRIMARY=0,SECONDARY=1,DANGER_BUTTON=2,TONAL=3,SELECTED=4;
 private static final int OFFLINE=0,CONNECTING=1,PAIRING=2,CONNECTED=3,NAVIGATING=4,FAILED=5;
 private int BG,SURFACE,SURFACE2,BORDER,BORDER_STRONG,TEXT,MUTED,ACCENT,ACCENT_STRONG,ACCENT_SOFT,ON_ACCENT,DANGER,DANGER_SOFT,SUCCESS,SUCCESS_SOFT,WARN,WARN_SOFT,LOG_BG,LOG_TEXT;
 private boolean night;
 private TextView chip,statusTitle,statusDetail,primary,search,repair,scanLabel,setupSummary,navMain,navRoad,navMeta,manualState,manualStop,settingsInfo,logView,logToggle;
 private LinearLayout statusBox,secondaryRow,devices,scanRow,maneuver,setupBody;private TurnIcon turn;private Switch automatic;
 private final TextView[] levels=new TextView[3],ranges=new TextView[2];private final List<View> needsConnection=new ArrayList<>();
 private Step bluetoothStep,listenerStep,batteryStep;private boolean logExpanded,wasConnected;private String shownLog="";private int primaryMode;
 private BluetoothLeScanner scanner;private boolean scanning;private final Set<String> seen=new HashSet<>();private final Handler handler=new Handler(Looper.getMainLooper());
 private final Runnable refresh=new Runnable(){public void run(){render();handler.postDelayed(this,1000);}};
 private final ScanCallback scan=new ScanCallback(){@Override public void onScanResult(int type,ScanResult result){runOnUiThread(()->found(result));}@Override public void onScanFailed(int code){runOnUiThread(()->{scanning=false;notice("Bluetooth-Suche fehlgeschlagen: "+code);render();});}};
 private static final class Step {String number;TextView badge,title,sub,action;}

 @Override public void onCreate(Bundle saved){
  night=(getResources().getConfiguration().uiMode&Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES;
  setTheme(night?android.R.style.Theme_Material_NoActionBar:android.R.style.Theme_Material_Light_NoActionBar);
  super.onCreate(saved);palette();systemBars();
  LinearLayout column=new LinearLayout(this);column.setOrientation(LinearLayout.VERTICAL);int pad=dp(16);
  column.setOnApplyWindowInsetsListener((view,insets)->{view.setPadding(pad+insets.getSystemWindowInsetLeft(),dp(8)+insets.getSystemWindowInsetTop(),pad+insets.getSystemWindowInsetRight(),dp(24)+insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});
  ScrollView scroll=new ScrollView(this);scroll.setBackgroundColor(BG);scroll.setClipToPadding(false);scroll.addView(column);setContentView(scroll);
  header(column);scooterCard(column);setupCard(column);navigationCard(column);settingsCard(column);logCard(column);infoCard(column);
  ConnectService.log("G3 Connect Android Beta 17 geöffnet · Android "+Build.VERSION.RELEASE);
 }

 // ── Farben und Systemleisten ─────────────────────────────
 private void palette(){
  if(night){BG=0xFF0B1015;SURFACE=0xFF11171E;SURFACE2=0xFF17202A;BORDER=0xFF232E3A;BORDER_STRONG=0xFF33414F;TEXT=0xFFE7EDF3;MUTED=0xFF93A2B2;ACCENT=0xFF2CCDB9;ACCENT_STRONG=0xFF6EE6D6;ACCENT_SOFT=0xFF0F2D2A;ON_ACCENT=0xFF04241F;DANGER=0xFFFF7B6E;DANGER_SOFT=0xFF361613;SUCCESS=0xFF4FD394;SUCCESS_SOFT=0xFF0F2A1D;WARN=0xFFFFBB45;WARN_SOFT=0xFF30230B;LOG_BG=0xFF070B0F;LOG_TEXT=0xFFCFDBE6;}
  else{BG=0xFFF2F4F7;SURFACE=0xFFFFFFFF;SURFACE2=0xFFF5F7FA;BORDER=0xFFE1E6EC;BORDER_STRONG=0xFFC9D2DC;TEXT=0xFF101828;MUTED=0xFF5D6B7A;ACCENT=0xFF0B7D73;ACCENT_STRONG=0xFF075E57;ACCENT_SOFT=0xFFE2F4F1;ON_ACCENT=0xFFFFFFFF;DANGER=0xFFC0291C;DANGER_SOFT=0xFFFDECEB;SUCCESS=0xFF08794A;SUCCESS_SOFT=0xFFE5F6ED;WARN=0xFF9A5800;WARN_SOFT=0xFFFFF4E2;LOG_BG=0xFF0F151C;LOG_TEXT=0xFFD4DFEA;}
 }
 @SuppressWarnings("deprecation") private void systemBars(){
  Window w=getWindow();w.getDecorView().setBackgroundColor(BG);w.setStatusBarColor(BG);w.setNavigationBarColor(BG);
  if(!night)w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
 }

 // ── Kopf ─────────────────────────────────────────────────
 private void header(LinearLayout column){
  LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(dp(2),dp(8),0,dp(4));column.addView(row);
  TextView logo=text("G3",15,ON_ACCENT,Typeface.DEFAULT_BOLD);logo.setGravity(Gravity.CENTER);logo.setBackground(shape(ACCENT,12,0));row.addView(logo,new LinearLayout.LayoutParams(dp(42),dp(42)));
  LinearLayout titles=vertical();LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,-2,1);lp.leftMargin=dp(12);row.addView(titles,lp);
  titles.addView(text("G3 Connect",20,TEXT,Typeface.DEFAULT_BOLD));titles.addView(text("Ninebot MAX G3 · Android Beta 17",12.5f,MUTED,null));
  chip=text("Offline",13,MUTED,medium());chip.setPadding(dp(12),dp(6),dp(12),dp(6));chip.setCompoundDrawablePadding(dp(8));row.addView(chip);
 }

 // ── Roller verbinden ─────────────────────────────────────
 private void scooterCard(LinearLayout column){
  LinearLayout card=card(column);title(card,"Roller",null);
  statusBox=vertical();statusBox.setPadding(dp(14),dp(12),dp(14),dp(12));add(card,statusBox,12);
  statusTitle=text("",15.5f,TEXT,medium());statusBox.addView(statusTitle);statusDetail=text("",13.5f,MUTED,null);statusBox.addView(statusDetail);
  primary=button("Roller suchen",PRIMARY,()->{if(primaryMode==0)disconnect();else if(primaryMode==1)last(false);else search();});primary.setMinHeight(dp(54));primary.setTextSize(TypedValue.COMPLEX_UNIT_SP,16);add(card,primary,14);
  secondaryRow=row(card,8);search=button("Roller suchen",SECONDARY,this::search);cell(secondaryRow,search);repair=button("Neu koppeln",SECONDARY,()->last(true));cell(secondaryRow,repair);
  scanRow=new LinearLayout(this);scanRow.setGravity(Gravity.CENTER_VERTICAL);add(card,scanRow,14);
  ProgressBar spinner=new ProgressBar(this,null,android.R.attr.progressBarStyleSmall);spinner.setIndeterminateTintList(ColorStateList.valueOf(ACCENT));scanRow.addView(spinner,new LinearLayout.LayoutParams(dp(20),dp(20)));
  scanLabel=text("Suche nach G3 in der Nähe …",14,MUTED,null);scanLabel.setPadding(dp(10),0,0,0);scanRow.addView(scanLabel);
  devices=vertical();add(card,devices,4);
  hint(card,"Roller einschalten und die Segway-App schließen. Bei „Neu koppeln“ erst auf Aufforderung die Power-Taste kurz drücken.",12);
 }

 // ── Einrichtung ──────────────────────────────────────────
 private void setupCard(LinearLayout column){
  LinearLayout card=card(column);LinearLayout head=row(card,0);head.setGravity(Gravity.CENTER_VERTICAL);
  TextView t=text("Einrichtung",18,TEXT,Typeface.DEFAULT_BOLD);head.addView(t,new LinearLayout.LayoutParams(0,-2,1));setupSummary=text("",13,MUTED,medium());head.addView(setupSummary);
  setupBody=vertical();add(card,setupBody,6);
  bluetoothStep=step(setupBody,"1","Bluetooth-Berechtigung","Zum Suchen und Verbinden des Rollers.","Erlauben",this::permissions);
  listenerStep=step(setupBody,"2","Benachrichtigungszugriff","Damit G3 Connect die Google-Maps-Hinweise lesen kann.","Öffnen",()->startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
  batteryStep=step(setupBody,"3","Akkuoptimierung aus · empfohlen","Verhindert, dass Android die Verbindung unterwegs beendet.","Öffnen",()->{try{startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));}catch(Exception e){notice("Einstellung nicht verfügbar.");}});
  hint(card,"Benachrichtigungszugriff unter Android 13+ gesperrt? In den App-Infos von G3 Connect „Eingeschränkte Einstellungen zulassen“.",10);
 }
 private Step step(LinearLayout parent,String number,String title,String sub,String action,Runnable run){
  Step s=new Step();s.number=number;LinearLayout r=new LinearLayout(this);r.setGravity(Gravity.CENTER_VERTICAL);r.setPadding(0,dp(10),0,dp(10));parent.addView(r);
  s.badge=text(number,13,ACCENT_STRONG,Typeface.DEFAULT_BOLD);s.badge.setGravity(Gravity.CENTER);r.addView(s.badge,new LinearLayout.LayoutParams(dp(30),dp(30)));
  LinearLayout texts=vertical();LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,-2,1);lp.leftMargin=dp(12);lp.rightMargin=dp(8);r.addView(texts,lp);
  s.title=text(title,15,TEXT,medium());texts.addView(s.title);s.sub=text(sub,12.5f,MUTED,null);texts.addView(s.sub);
  s.action=button(action,TONAL,run);s.action.setMinHeight(dp(38));s.action.setPadding(dp(14),dp(6),dp(14),dp(6));s.action.setTextSize(TypedValue.COMPLEX_UNIT_SP,13.5f);r.addView(s.action);
  return s;
 }
 private void stepState(Step s,boolean done){
  s.badge.setText(done?"✓":s.number);
  s.badge.setTextColor(done?ON_ACCENT:ACCENT_STRONG);s.badge.setBackground(oval(done?SUCCESS:ACCENT_SOFT));s.action.setVisibility(done?View.GONE:View.VISIBLE);
 }

 // ── Navigation ───────────────────────────────────────────
 private void navigationCard(LinearLayout column){
  LinearLayout card=card(column);title(card,"Navigation","Google Maps → G3-Display");
  maneuver=new LinearLayout(this);maneuver.setGravity(Gravity.CENTER_VERTICAL);maneuver.setPadding(dp(14),dp(14),dp(16),dp(14));add(card,maneuver,12);
  FrameLayout tile=new FrameLayout(this);tile.setBackground(shape(0x1F808080,16,0));maneuver.addView(tile,new LinearLayout.LayoutParams(dp(64),dp(64)));
  turn=new TurnIcon(this);FrameLayout.LayoutParams ip=new FrameLayout.LayoutParams(dp(42),dp(42),Gravity.CENTER);tile.addView(turn,ip);
  LinearLayout texts=vertical();LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,-2,1);lp.leftMargin=dp(14);maneuver.addView(texts,lp);
  navMain=text("",21,TEXT,Typeface.DEFAULT_BOLD);texts.addView(navMain);navRoad=text("",15,TEXT,medium());texts.addView(navRoad);navMeta=text("",13,MUTED,null);texts.addView(navMeta);
  automatic=new Switch(this);automatic.setText("Google Maps automatisch am G3 starten / beenden");automatic.setTextColor(TEXT);automatic.setTextSize(TypedValue.COMPLEX_UNIT_SP,15);automatic.setTypeface(medium());
  int[][] states={{android.R.attr.state_checked},{}};automatic.setThumbTintList(new ColorStateList(states,new int[]{ACCENT,night?0xFF93A2B2:0xFFFFFFFF}));automatic.setTrackTintList(new ColorStateList(states,new int[]{ACCENT,BORDER_STRONG}));
  automatic.setPadding(dp(14),dp(12),dp(10),dp(12));automatic.setBackground(shape(SURFACE2,14,BORDER));automatic.setSwitchPadding(dp(12));
  automatic.setChecked(ConnectService.armed);automatic.setOnCheckedChangeListener((v,checked)->ConnectService.arm(checked));add(card,automatic,12);
  LinearLayout r=row(card,12);
  cell(r,button("Google Maps öffnen",PRIMARY,()->{Intent i=getPackageManager().getLaunchIntentForPackage("com.google.android.apps.maps");if(i==null)notice("Google Maps ist nicht installiert.");else startActivity(i);}));
  TextView stop=button("Stoppen",DANGER_BUTTON,()->{automatic.setChecked(false);ConnectService s=ConnectService.instance;if(s!=null)s.stopNavigation();});cell(r,stop);
  hint(card,"Vor dem Losfahren verbinden und auf den ersten Pfeil warten. „Stoppen“ beendet die Display-Navigation und schaltet die Automatik aus.",10);
  divider(card);TextView tools=text("Werkzeuge",14,MUTED,medium());add(card,tools,0);
  LinearLayout r2=row(card,10);TextView manual=button("Manuell senden …",SECONDARY,this::manualDialog);cell(r2,manual);
  TextView test=button("Displaytest · 15 s",SECONDARY,()->{ConnectService s=ConnectService.instance;if(s==null||!ConnectService.connected)notice("Zuerst verbinden.");else{s.displayTest();notice("Displaytest: Linkspfeil, 100 m, 15 Sekunden.");}});cell(r2,test);
  needsConnection.add(manual);needsConnection.add(test);
  manualState=text("",13,MUTED,null);add(card,manualState,10);
  manualStop=button("Manuelles Senden stoppen",DANGER_BUTTON,()->{ConnectService service=ConnectService.instance;if(service!=null)service.stopManual();});add(card,manualStop,8);
 }

 // ── Einstellungen ────────────────────────────────────────
 private void settingsCard(LinearLayout column){
  LinearLayout card=card(column);title(card,"Roller-Einstellungen","Nur im Stillstand · jeder Wert wird zurückgelesen");
  add(card,text("Beschleunigung im Sportmodus",14,TEXT,medium()),14);LinearLayout r=row(card,8);
  for(int i=1;i<=3;i++){final int level=i;levels[i-1]=button("Stufe "+i,SECONDARY,()->setting("Stufe "+level+" wird geschrieben und zurückgelesen …",c->{c.acceleration(level);knownLevel=level;settingsNote="Stufe "+level+" vom Roller bestätigt.";}));cell(r,levels[i-1]);needsConnection.add(levels[i-1]);}
  add(card,text("Reichweitenanzeige am Display",14,TEXT,medium()),16);LinearLayout r2=row(card,8);
  for(int i=0;i<2;i++){final boolean on=i==0;ranges[i]=button(on?"Ein":"Aus",SECONDARY,()->setting("Reichweitenanzeige wird "+(on?"ein":"aus")+"geschaltet …",c->{c.range(on);knownRange=on?1:0;settingsNote="Reichweitenanzeige "+(on?"ein":"aus")+" · Rücklesen bestätigt.";}));cell(r2,ranges[i]);needsConnection.add(ranges[i]);}
  settingsInfo=text("",13.5f,MUTED,null);add(card,settingsInfo,14);
  TextView read=button("Werte auslesen",TONAL,this::readSettings);add(card,read,12);needsConnection.add(read);
 }
 private void readSettings(){ConnectService s=ConnectService.instance;if(s==null||!ConnectService.connected){notice("Zuerst Roller verbinden.");return;}settingsNote="Werte werden gelesen …";render();s.command(readJob());}
 private static ConnectService.Job readJob(){return c->{try{int level=c.read(0x6e);boolean range=(c.read(0x2f)&0x10)!=0;knownLevel=level;knownRange=range?1:0;settingsNote="";ConnectService.log("Beschleunigung: "+level+" · Reichweitenanzeige: "+(range?"ein":"aus"));}catch(Exception e){settingsNote="Auslesen fehlgeschlagen: "+ConnectService.message(e);throw e;}};}
 private void setting(String pending,ConnectService.Job job){
  ConnectService s=ConnectService.instance;if(s==null||!ConnectService.connected){notice("Zuerst Roller verbinden.");return;}
  settingsNote=pending;render();s.command(c->{try{job.run(c);}catch(Exception e){settingsNote="Nicht übernommen: "+ConnectService.message(e);throw e;}});
 }

 // ── Protokoll ────────────────────────────────────────────
 private void logCard(LinearLayout column){
  LinearLayout card=card(column);LinearLayout head=row(card,0);head.setGravity(Gravity.CENTER_VERTICAL);
  head.addView(text("Protokoll",18,TEXT,Typeface.DEFAULT_BOLD),new LinearLayout.LayoutParams(0,-2,1));
  TextView copy=button("Kopieren",TONAL,()->{clip("G3 Connect Log",ConnectService.logs());notice("Log kopiert.");});copy.setMinHeight(dp(36));copy.setPadding(dp(14),dp(4),dp(14),dp(4));copy.setTextSize(TypedValue.COMPLEX_UNIT_SP,13.5f);head.addView(copy);
  logView=text("",11.5f,LOG_TEXT,Typeface.MONOSPACE);logView.setTextIsSelectable(true);logView.setPadding(dp(12),dp(10),dp(12),dp(10));logView.setBackground(shape(LOG_BG,14,0));logView.setLineSpacing(0,1.2f);add(card,logView,12);
  LinearLayout r=row(card,10);logToggle=button("Alles anzeigen",SECONDARY,()->{logExpanded=!logExpanded;shownLog="";render();});cell(r,logToggle);
  cell(r,button("Maps-Diagnose",SECONDARY,()->{clip("G3 Connect Maps-Diagnose",MapsState.diagnostic);notice("Maps-Diagnose kopiert. Enthält den aktuellen Maps-Text und Straßennamen.");}));
  hint(card,"Bei fehlenden Pfeilen zeigt die Maps-Diagnose, welche Angaben Android liefert. Sie enthält den Maps-Navigationstext einschließlich Straßennamen; andere Apps und Bluetooth-Schlüssel werden nicht erfasst.",10);
 }

 // ── Hinweise ─────────────────────────────────────────────
 private void infoCard(LinearLayout column){
  LinearLayout card=card(column);TextView head=text("Hinweise und Lizenzen  ▾",15,TEXT,medium());add(card,head,0);
  TextView body=text("Fehlt die Gesamt-Reststrecke in Maps, sendet die App 1337 km als festen Platzhalter. Abbiegedistanz und Richtung kommen weiterhin aus Maps.\n\nAndere Bluetooth-Apps vor dem Verbinden schließen. Bei Bedarf G3 Connect von der Akkuoptimierung ausnehmen.\n\nBeta: Google-Maps-Formate und Pfeilerkennung können je nach Version abweichen. Nicht erkennbare Hinweise stoppen die Übertragung. Die G3-Pakete sind am Roller bestätigt; Bluetooth und Maps-Erfassung wurden auf Android 16 bestätigt; neue Display-Funktionen am Roller prüfen.\n\nAndere App-Benachrichtigungen werden vor dem Lesen gefiltert. Kopplungsschlüssel bleiben im privaten App-Speicher. Keine Firmware-Updates. Modell: OpenDash / KTM-Nav-GEN3 (MIT); TensorFlow Lite (Apache 2.0). Lizenzen sind im APK und im Quellcode enthalten.",13,MUTED,null);
  body.setVisibility(View.GONE);add(card,body,10);
  head.setOnClickListener(v->{boolean open=body.getVisibility()!=View.VISIBLE;body.setVisibility(open?View.VISIBLE:View.GONE);head.setText(open?"Hinweise und Lizenzen  ▴":"Hinweise und Lizenzen  ▾");});
 }

 // ── Zustand anzeigen (jede Sekunde) ──────────────────────
 private void render(){
  boolean connected=ConnectService.connected;ConnectService service=ConnectService.instance;String status=ConnectService.status;
  boolean justConnected=connected&&!wasConnected;if(connected!=wasConnected){knownLevel=0;knownRange=-1;settingsNote="";}
  wasConnected=connected;
  // Read the current values once per connection, like the web app does after connecting.
  if(justConnected){ConnectService s=ConnectService.instance;if(s!=null){settingsNote="Werte werden gelesen …";s.command(readJob());}}
  int state=connected?(ConnectService.manualActive||status.startsWith("Navigation ans G3")?NAVIGATING:CONNECTED):service!=null?(status.contains("Power-Taste")?PAIRING:CONNECTING):status.startsWith("Verbindung fehlgeschlagen")||status.startsWith("Angehalten")?FAILED:OFFLINE;
  // Kopf-Chip
  String[] chipText={"Offline","Verbindet …","Koppeln","Verbunden",ConnectService.manualActive?"Manuell":"Navigation","Fehler"};
  int[] chipFg={MUTED,WARN,WARN,SUCCESS,ON_ACCENT,DANGER},chipBg={SURFACE2,WARN_SOFT,WARN_SOFT,SUCCESS_SOFT,ACCENT,DANGER_SOFT};
  chip.setText(chipText[state]);chip.setTextColor(chipFg[state]);chip.setBackground(shape(chipBg[state],99,state==OFFLINE?BORDER:0));
  GradientDrawable dot=oval(chipFg[state]);dot.setSize(dp(8),dp(8));chip.setCompoundDrawablesRelativeWithIntrinsicBounds(dot,null,null,null);
  // Statusfeld
  statusTitle.setText(state==PAIRING?"Jetzt Power-Taste kurz drücken":state==OFFLINE&&!status.startsWith("Nicht verbunden")?status:state==OFFLINE?"Nicht verbunden":status);
  statusDetail.setText(state==PAIRING?"Der Roller wartet auf die Bestätigung. Danach merkt sich die App die Kopplung.":state==OFFLINE?(hasLast()?"Letzter Roller ist gespeichert.":"Noch kein Roller gespeichert. Zuerst suchen."):state==CONNECTING?"Verbindung wird aufgebaut …":state==FAILED?"Roller eingeschaltet? Segway-App geschlossen? Dann erneut versuchen oder neu koppeln.":ConnectService.manualActive?"Manueller Modus · Maps pausiert.":MapsState.status);
  int boxBg=state==CONNECTED||state==NAVIGATING?SUCCESS_SOFT:state==PAIRING||state==CONNECTING?WARN_SOFT:state==FAILED?DANGER_SOFT:SURFACE2;
  int boxLine=state==PAIRING?WARN:state==FAILED?DANGER:state==CONNECTED||state==NAVIGATING?0:BORDER;
  statusBox.setBackground(shape(boxBg,14,boxLine));statusTitle.setTextColor(state==PAIRING||state==CONNECTING?WARN:state==FAILED?DANGER:state==CONNECTED||state==NAVIGATING?SUCCESS:TEXT);
  statusTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP,state==PAIRING?18:15.5f);
  // Verbindungsknöpfe
  boolean online=service!=null;primaryMode=online?0:hasLast()?1:2;
  primary.setText(online?(connected?"Verbindung trennen":"Abbrechen"):hasLast()?"Mit letztem Roller verbinden":"Roller suchen");style(primary,online?DANGER_BUTTON:PRIMARY);
  secondaryRow.setVisibility(!online&&hasLast()?View.VISIBLE:View.GONE);
  enable(search,!scanning);
  scanRow.setVisibility(scanning?View.VISIBLE:View.GONE);devices.setVisibility(online?View.GONE:View.VISIBLE);
  // Einrichtung
  boolean bt=allowed(),listener=MapsState.listenerReady,battery=batteryUnrestricted();
  stepState(bluetoothStep,bt);stepState(listenerStep,listener);stepState(batteryStep,battery);
  int done=(bt?1:0)+(listener?1:0)+(battery?1:0);setupSummary.setText(bt&&listener?"Bereit ✓":done+" von 3");setupSummary.setTextColor(bt&&listener?SUCCESS:MUTED);
  // Navigation
  if(automatic.isChecked()!=ConnectService.armed)automatic.setChecked(ConnectService.armed);
  MapsState.Sample sample=MapsState.current;boolean live=state==NAVIGATING||sample!=null&&connected&&ConnectService.armed;
  if(ConnectService.manualActive){turn.set(-1,ON_ACCENT);navMain.setText("Manuelles Senden");navRoad.setText(ConnectService.manualStatus);navMeta.setText("Maps pausiert");}
  else if(sample!=null){turn.set(sample.icon,live?ON_ACCENT:ACCENT_STRONG);navMain.setText(distance(sample.step));navRoad.setText(sample.road==null||sample.road.isEmpty()?"Dem Straßenverlauf folgen":sample.road);
   navMeta.setText((sample.distancePlaceholder?"Reststrecke unbekannt":distance(sample.remaining)+" verbleibend")+" · ca. "+Math.max(1,(sample.seconds+59)/60)+" min");}
  else{turn.set(-1,MUTED);navMain.setText(connected?"Warte auf Google Maps":"Keine Navigation");navRoad.setText(ConnectService.armed?"In Google Maps eine Route starten.":"Maps-Automatik ist aus.");navMeta.setText(MapsState.status);}
  maneuver.setBackground(shape(live||ConnectService.manualActive?ACCENT:SURFACE2,18,live||ConnectService.manualActive?0:BORDER));
  int fg=live||ConnectService.manualActive?ON_ACCENT:TEXT;navMain.setTextColor(fg);navRoad.setTextColor(fg);navMeta.setTextColor(live||ConnectService.manualActive?ON_ACCENT:MUTED);navMeta.setAlpha(live?.85f:1f);
  manualState.setText(ConnectService.manualStatus);manualStop.setVisibility(ConnectService.manualActive?View.VISIBLE:View.GONE);
  // Einstellungen
  for(View v:needsConnection)enable(v,connected);
  for(int i=0;i<3;i++)style(levels[i],knownLevel==i+1?SELECTED:SECONDARY);
  style(ranges[0],knownRange==1?SELECTED:SECONDARY);style(ranges[1],knownRange==0?SELECTED:SECONDARY);
  String known=(knownLevel>=1&&knownLevel<=3?"Aktuell: Stufe "+knownLevel:knownLevel!=0?"Unbekannter Stufenwert: "+knownLevel:"Stufe noch nicht gelesen")+" · Reichweite "+(knownRange<0?"unbekannt":knownRange==1?"ein":"aus");
  settingsInfo.setText(!connected?"Mit dem Roller verbinden, um Werte zu lesen und zu ändern.":settingsNote.isEmpty()?known:settingsNote+"\n"+known);
  // Protokoll
  String all=ConnectService.logs(),visible=all;
  if(!logExpanded){String[] lines=all.split("\n");int from=Math.max(0,lines.length-14);StringBuilder b=new StringBuilder();for(int i=from;i<lines.length;i++){if(b.length()>0)b.append('\n');b.append(lines[i]);}visible=b.toString();}
  if(!visible.equals(shownLog)){shownLog=visible;logView.setText(visible.isEmpty()?"Noch keine Einträge.":visible);}
  logToggle.setText(logExpanded?"Weniger anzeigen":"Alles anzeigen");
 }
 private static String distance(int meters){return meters<1000?meters+" m":String.format(Locale.GERMANY,"%.1f km",meters/1000f);}
 private boolean hasLast(){SharedPreferences p=getSharedPreferences("g3",MODE_PRIVATE);return p.getString("device",null)!=null&&p.getString("name",null)!=null;}
 private boolean batteryUnrestricted(){try{return ((PowerManager)getSystemService(POWER_SERVICE)).isIgnoringBatteryOptimizations(getPackageName());}catch(Exception e){return false;}}

 // ── Manuelles Senden ─────────────────────────────────────
 private void manualDialog(){
  LinearLayout form=new LinearLayout(this);form.setOrientation(1);int pad=dp(20);form.setPadding(pad,dp(8),pad,0);ScrollView scroll=new ScrollView(this);scroll.addView(form);
  android.content.SharedPreferences preferences=getSharedPreferences("g3",MODE_PRIVATE);
  fieldLabel(form,"Richtung");Spinner direction=new Spinner(this);String[] names={"Vorwärts / geradeaus","Links","Rechts","Leicht links","Leicht rechts","Scharf links","Scharf rechts","Wenden","Kreisverkehr rechts","Kreisverkehr links","Ziel erreicht"};int[] icons={9,2,3,4,5,6,7,8,11,12,15};ArrayAdapter<String> options=new ArrayAdapter<>(this,android.R.layout.simple_spinner_item,names);options.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);direction.setAdapter(options);direction.setSelection(Math.min(names.length-1,Math.max(0,preferences.getInt("manualDirection",1))));form.addView(direction);
  EditText road=manualField(form,"Straße",preferences.getString("manualRoad","TESTSTRASSE"),InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_WORDS);
  EditText step=manualField(form,"Entfernung bis zum Abbiegen (m)",preferences.getString("manualStep","100"),InputType.TYPE_CLASS_NUMBER);
  EditText minutes=manualField(form,"Restfahrzeit (Minuten)",preferences.getString("manualMinutes","5"),InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);
  EditText remaining=manualField(form,"Reststrecke (km)",preferences.getString("manualRemaining","1337"),InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);
  EditText duration=manualField(form,"Sendedauer (Sekunden, 0 = bis Stopp)",preferences.getString("manualDuration","0"),InputType.TYPE_CLASS_NUMBER);
  CheckBox countdown=new CheckBox(this);countdown.setText("Restfahrzeit herunterzählen");countdown.setButtonTintList(ColorStateList.valueOf(ACCENT));countdown.setChecked(preferences.getBoolean("manualCountdown",false));add(form,countdown,10);
  hint(form,"Ohne Google Maps oder Benachrichtigungszugriff nutzbar. Dauersenden wiederholt ungefähr jede Sekunde. Die Vorgaben ersetzen vorübergehend die Maps-Navigation. Nach dem Stopp kannst du die Maps-Automatik wieder einschalten.",8);
  TextView error=text("",13.5f,DANGER,medium());add(form,error,6);
  AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Manuelle Display-Navigation").setView(scroll).setPositiveButton("Dauersenden",null).setNeutralButton("Einmal",null).setNegativeButton("Abbrechen",null).create();
  dialog.setOnShowListener(shown->{for(int which:new int[]{AlertDialog.BUTTON_POSITIVE,AlertDialog.BUTTON_NEUTRAL,AlertDialog.BUTTON_NEGATIVE})dialog.getButton(which).setTextColor(ACCENT);
   for(int which:new int[]{AlertDialog.BUTTON_POSITIVE,AlertDialog.BUTTON_NEUTRAL}){final boolean repeat=which==AlertDialog.BUTTON_POSITIVE;dialog.getButton(which).setOnClickListener(v->{try{
    ConnectService service=ConnectService.instance;if(service==null||!ConnectService.connected)throw new IllegalArgumentException("Zuerst mit dem Roller verbinden.");
    ManualSender.Config config=ManualSender.Config.parse(icons[direction.getSelectedItemPosition()],road.getText().toString(),step.getText().toString(),remaining.getText().toString(),minutes.getText().toString(),duration.getText().toString(),repeat,countdown.isChecked());
    preferences.edit().putInt("manualDirection",direction.getSelectedItemPosition()).putString("manualRoad",road.getText().toString()).putString("manualStep",step.getText().toString()).putString("manualMinutes",minutes.getText().toString()).putString("manualRemaining",remaining.getText().toString()).putString("manualDuration",duration.getText().toString()).putBoolean("manualCountdown",countdown.isChecked()).apply();
    service.startManual(config);automatic.setChecked(false);dialog.dismiss();
   }catch(Exception e){error.setText(ConnectService.message(e));}});}});dialog.show();
 }
 private void fieldLabel(LinearLayout parent,String label){add(parent,text(label,13,MUTED,medium()),12);}
 private EditText manualField(LinearLayout parent,String label,String value,int type){fieldLabel(parent,label);EditText edit=new EditText(this);edit.setInputType(type);edit.setSingleLine(true);edit.setFilters(new InputFilter[]{new InputFilter.LengthFilter(200)});edit.setText(value);edit.setContentDescription(label);edit.setBackgroundTintList(ColorStateList.valueOf(ACCENT));parent.addView(edit);return edit;}

 // ── Bluetooth (Verhalten unverändert) ────────────────────
 private void disconnect(){ConnectService s=ConnectService.instance;if(s!=null)s.disconnect();}
 private void permissions(){List<String> names=new ArrayList<>();if(Build.VERSION.SDK_INT>=31){names.add(Manifest.permission.BLUETOOTH_SCAN);names.add(Manifest.permission.BLUETOOTH_CONNECT);}else names.add(Manifest.permission.ACCESS_FINE_LOCATION);if(Build.VERSION.SDK_INT>=33)names.add(Manifest.permission.POST_NOTIFICATIONS);requestPermissions(names.toArray(new String[0]),1);}
 @Override public void onRequestPermissionsResult(int code,String[] names,int[] results){render();}
 private boolean allowed(){return Build.VERSION.SDK_INT>=31?checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)==PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED:checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;}
 private void search(){if(!allowed()){permissions();notice("Berechtigung erlauben und Suche erneut starten.");return;}stopScan();try{BluetoothAdapter a=((BluetoothManager)getSystemService(BLUETOOTH_SERVICE)).getAdapter();if(a==null||!a.isEnabled()){notice("Bluetooth einschalten.");return;}scanner=a.getBluetoothLeScanner();devices.removeAllViews();seen.clear();scanning=true;render();
   // No filter: some G3 advertisements omit service UUIDs. Only recognizable Ninebot devices enter the list.
   scanner.startScan(null,new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),scan);handler.postDelayed(()->{stopScan();render();if(seen.isEmpty())notice("Kein G3 gefunden. Roller einschalten; auf Android 8–11 auch Standort einschalten.");},10000);
  }catch(Exception e){scanning=false;notice(ConnectService.message(e));}}
 private void found(ScanResult r){if(!scanning||r.getScanRecord()==null)return;String name=r.getScanRecord().getDeviceName();if(name==null)name=r.getDevice().getName();if(name==null||!name.startsWith("1C"))return;String address=r.getDevice().getAddress();if(!seen.add(address))return;final String fullName=name;deviceRow(seen.size(),r.getRssi(),()->connect(address,fullName,false));}
 private void deviceRow(int number,int rssi,Runnable action){
  LinearLayout item=new LinearLayout(this);item.setGravity(Gravity.CENTER_VERTICAL);item.setPadding(dp(14),dp(12),dp(14),dp(12));item.setBackground(pressable(SURFACE2,14,BORDER,TEXT));item.setClickable(true);item.setOnClickListener(v->action.run());
  TextView icon=text("G3",12,ACCENT_STRONG,Typeface.DEFAULT_BOLD);icon.setGravity(Gravity.CENTER);icon.setBackground(oval(ACCENT_SOFT));item.addView(icon,new LinearLayout.LayoutParams(dp(36),dp(36)));
  LinearLayout texts=vertical();LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,-2,1);lp.leftMargin=dp(12);item.addView(texts,lp);
  texts.addView(text("Ninebot G3 · Gerät "+number,15,TEXT,medium()));texts.addView(text((rssi>=-65?"Signal stark":rssi>=-80?"Signal mittel":"Signal schwach")+" · "+rssi+" dBm",12.5f,MUTED,null));
  item.addView(text("Verbinden",14,ACCENT_STRONG,medium()));add(devices,item,8);
 }
 private void last(boolean force){String a=getSharedPreferences("g3",MODE_PRIVATE).getString("device",null),n=getSharedPreferences("g3",MODE_PRIVATE).getString("name",null);if(a==null||n==null){notice("Zuerst Roller suchen und auswählen.");return;}connect(a,n,force);}
 private void connect(String address,String name,boolean force){if(!allowed()){permissions();return;}stopScan();if(ConnectService.instance!=null){notice("Vor einem neuen Verbindungsversuch zuerst trennen.");return;}Intent i=new Intent(this,ConnectService.class).setAction("connect").putExtra("address",address).putExtra("name",name).putExtra("force",force);try{startForegroundService(i);}catch(Exception e){notice(ConnectService.message(e));}handler.postDelayed(this::render,150);}
 private void stopScan(){if(scanner!=null&&scanning)try{scanner.stopScan(scan);}catch(Exception ignored){}scanning=false;}
 private void notice(String text){Toast.makeText(this,text,Toast.LENGTH_LONG).show();ConnectService.log(text);}
 private void clip(String label,String value){((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText(label,value));}
 @Override public void onResume(){super.onResume();handler.removeCallbacks(refresh);handler.post(refresh);}
 @Override public void onPause(){stopScan();handler.removeCallbacks(refresh);super.onPause();}

 // ── Bausteine ────────────────────────────────────────────
 private int dp(float v){return Math.round(v*getResources().getDisplayMetrics().density);}
 private static Typeface medium(){return Typeface.create("sans-serif-medium",Typeface.NORMAL);}
 private GradientDrawable shape(int fill,int radius,int stroke){GradientDrawable g=new GradientDrawable();g.setColor(fill);g.setCornerRadius(dp(radius));if(stroke!=0)g.setStroke(dp(1),stroke);return g;}
 private GradientDrawable oval(int fill){GradientDrawable g=new GradientDrawable();g.setShape(GradientDrawable.OVAL);g.setColor(fill);return g;}
 private Drawable pressable(int fill,int radius,int stroke,int ink){return new RippleDrawable(ColorStateList.valueOf((ink&0xFFFFFF)|0x33000000),shape(fill,radius,stroke),shape(Color.WHITE,radius,0));}
 private LinearLayout vertical(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);return l;}
 private TextView text(String value,float sp,int color,Typeface face){TextView t=new TextView(this);t.setText(value);t.setTextSize(TypedValue.COMPLEX_UNIT_SP,sp);t.setTextColor(color);if(face!=null)t.setTypeface(face);t.setLineSpacing(0,1.12f);return t;}
 private void hint(LinearLayout parent,String value,int top){add(parent,text(value,12.5f,MUTED,null),top);}
 private void add(LinearLayout parent,View v,int top){LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=dp(top);parent.addView(v,lp);}
 private LinearLayout row(LinearLayout parent,int top){LinearLayout r=new LinearLayout(this);add(parent,r,top);return r;}
 private void cell(LinearLayout row,View v){LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,-2,1);if(row.getChildCount()>0)lp.leftMargin=dp(8);row.addView(v,lp);}
 private void divider(LinearLayout parent){View d=new View(this);d.setBackgroundColor(BORDER);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(1));lp.topMargin=dp(16);lp.bottomMargin=dp(14);parent.addView(d,lp);}
 private LinearLayout card(LinearLayout column){LinearLayout c=vertical();c.setPadding(dp(18),dp(18),dp(18),dp(18));c.setBackground(shape(SURFACE,22,BORDER));c.setElevation(night?0:dp(1));LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=dp(14);column.addView(c,lp);return c;}
 private void title(LinearLayout card,String title,String sub){card.addView(text(title,18,TEXT,Typeface.DEFAULT_BOLD));if(sub!=null)add(card,text(sub,13,MUTED,null),2);}
 private TextView button(String label,int style,Runnable action){TextView b=text(label,15,TEXT,medium());b.setGravity(Gravity.CENTER);b.setMinHeight(dp(48));b.setPadding(dp(14),dp(10),dp(14),dp(10));b.setClickable(true);b.setFocusable(true);b.setOnClickListener(v->action.run());style(b,style);return b;}
 private void style(TextView b,int style){
  Integer current=(Integer)b.getTag();if(current!=null&&current==style)return;b.setTag(style);
  int fill,fg,line=0;
  switch(style){case PRIMARY:fill=ACCENT;fg=ON_ACCENT;break;case DANGER_BUTTON:fill=SURFACE;fg=DANGER;line=DANGER;break;case TONAL:fill=ACCENT_SOFT;fg=ACCENT_STRONG;break;case SELECTED:fill=ACCENT_SOFT;fg=ACCENT_STRONG;line=ACCENT;break;default:fill=SURFACE;fg=TEXT;line=BORDER_STRONG;}
  b.setTextColor(fg);b.setBackground(pressable(fill,14,line,fg));
 }
 private void enable(View v,boolean on){v.setEnabled(on);v.setAlpha(on?1f:.4f);}
}
