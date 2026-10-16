import {ROUTER,distance,parseCoordinates,makeRoute,locate,getJSON} from './navigation.js?v=10';
import {createMapsBridge} from './maps-bridge.js?v=10';
const fmt=m=>m<1000?`${Math.round(m)} m`:`${(m/1000).toFixed(1)} km`;
export function installNavigation({getClient,isBusy,setBusy,log}){
 const $=id=>document.getElementById(id);
 const legacyMapsUI=!!$('maps-connect');
 let location=null,destination=null,route=null,active=false,watch=null,timer=null,wake=null,progress=null,lastFix=0,state=null;
 let working=false,verifiedDevice=null,activeDevice=null,controller=null,testSent=false,testDevice=null,displayTesting=false,testDeadline=0,sentInitial=false,lastInstruction='',lastWarning='',googleMode=false,mapsTotal=0;
 const maps=createMapsBridge(value=>{
  if(!legacyMapsUI)return;
  $('maps-bridge-status').textContent=value.ok?'Google-Maps-Hinweis empfangen.':value.message;
  $('maps-guidance').textContent=value.raw?.active?`${value.raw.title||''} · ${value.raw.road||''} · ${value.raw.summary||''}`:'';
  $('maps-confidence').textContent=typeof value.raw?.confidence==='number'?`Modellscore der Pfeilerkennung: ${Math.round(value.raw.confidence*100)} % · experimentell`:'';
  update();
 });
 const say=text=>$('nav-status').textContent=text;
 const connected=()=>!!getClient()?.authenticated;
 function update(){
  const c=getClient(),online=!!c?.authenticated,locked=working||isBusy();
  if(testDevice&&(!online||testDevice!==c?.device?.id)){testDevice=null;testSent=false;verifiedDevice=null;$('nav-verified').checked=false;}
  if(verifiedDevice&&(!online||verifiedDevice!==c?.device?.id)){verifiedDevice=null;$('nav-verified').checked=false;testSent=false;}
  if(active&&activeDevice&&(!online||activeDevice!==c?.device?.id)){release();say('Bluetooth getrennt. Navigation beendet; nach erneutem Verbinden neu starten.');log('Navigation durch Bluetooth-Trennung beendet.');}
  $('nav-location').disabled=locked||active;$('nav-find').disabled=locked||active;
  $('nav-query').disabled=working||active;$('nav-results').disabled=working||active;
  $('nav-plan').disabled=locked||active||!location||!destination;
  $('nav-phone').disabled=locked||active||!route;
  $('nav-start').disabled=locked||active||!route||!online||verifiedDevice!==c?.device?.id;
  $('nav-test').disabled=locked||active||!online;
  $('nav-verified').disabled=locked||active||!online||!testSent;
  $('nav-stop').disabled=locked||(!active&&!c?.navigationStarted);
  if(legacyMapsUI){
  $('maps-connect').disabled=locked||maps.connected();
  $('maps-disconnect').disabled=locked||!maps.connected();
  $('maps-start').disabled=locked||active||!online||verifiedDevice!==c?.device?.id||!maps.latest();
  }
 }
 async function exclusive(fn){if(isBusy()||working)throw new Error('Eine andere Aktion läuft.');setBusy(true);try{return await fn();}finally{setBusy(false);}}
 async function apiAction(fn){if(working||active)return;working=true;controller=new AbortController();update();try{await fn(controller.signal);}catch(e){say(e.name==='AbortError'?'Anfrage abgebrochen.':e.message);log(`Navigation: ${e.message}`,'ERROR');}finally{working=false;controller=null;update();}}
 function getPosition(){return new Promise((resolve,reject)=>{
  if(!navigator.geolocation)return reject(new Error('Standort ist in diesem Browser nicht verfügbar.'));
  navigator.geolocation.getCurrentPosition(resolve,e=>reject(new Error(`Standort nicht verfügbar: ${e.message}`)),{enableHighAccuracy:true,maximumAge:0,timeout:15000});
 });}
 function usePosition(p){
  const {longitude,latitude,accuracy}=p.coords;
  if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||!Number.isFinite(accuracy))throw new Error('Ungültige Standortmeldung.');
  location=[longitude,latitude];$('nav-position').textContent=`Standort erfasst · Genauigkeit ±${Math.round(accuracy)} m`;
  return accuracy;
 }
 function draw(){
  const svg=$('nav-map');if(!route){svg.hidden=true;return;}
  const coords=route.points,lat=coords[0][1]*Math.PI/180,sx=Math.cos(lat);
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const p of coords){minX=Math.min(minX,p[0]*sx);maxX=Math.max(maxX,p[0]*sx);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}
  const scale=Math.min(440/(maxX-minX||1e-7),200/(maxY-minY||1e-7));
  const xy=p=>[(20+(p[0]*sx-minX)*scale).toFixed(2),(220-(p[1]-minY)*scale).toFixed(2)];
  const path=coords.map((p,i)=>(i?'L':'M')+xy(p).join(',')).join(' ');
  $('nav-route-path').setAttribute('d',path);
  const start=xy(coords[0]),end=xy(coords.at(-1));
  for(const [name,v]of [['nav-route-start',start],['nav-route-end',end]]){$(name).setAttribute('cx',v[0]);$(name).setAttribute('cy',v[1]);}
  const dot=$('nav-route-position');dot.hidden=!location;if(location){const v=xy(location);dot.setAttribute('cx',v[0]);dot.setAttribute('cy',v[1]);}
  svg.hidden=false;
 }
 function release(){
  active=false;activeDevice=null;googleMode=false;displayTesting=false;clearInterval(timer);timer=null;
  if(watch!==null)navigator.geolocation.clearWatch(watch);watch=null;
  wake?.release().catch(()=>{});wake=null;
 }
 async function stop(message='Navigation beendet.'){
  release();
  try{if(getClient()?.navigationStarted)await exclusive(()=>getClient().stopNavigation());}
  catch(e){log(`Navigation beenden: ${e.message}`,'ERROR');message+=' Display-Ende nicht bestätigt.';}
  say(message);update();
 }
 function warning(message){say(message);if(lastWarning!==message){log(`Navigation: ${message}`);lastWarning=message;}}
 async function tick(){
  if(!active||working||isBusy())return;
  if(displayTesting){
   if(Date.now()>=testDeadline){await stop('Displaytest nach 15 Sekunden beendet. Nur bei sichtbar gewesenem Linkspfeil mit 100 m bestätigen; sonst Log kopieren.');return;}
  }else if(googleMode){
   const latest=maps.latest();
   if(!latest){await stop('Google-Maps-Hinweise fehlen oder sind unsicher. Navigation zum Display angehalten.');return;}
   state=latest;
   $('nav-instruction').textContent=`Google Maps · ${fmt(state.stepRemaining)}`;
   $('nav-road').textContent=state.nextRoad;$('nav-remaining').textContent=`${fmt(state.remaining)} verbleibend · ${Math.ceil(state.seconds/60)} min`;
  }else if(!lastFix||Date.now()-lastFix>8000){await stop('GPS-Daten fehlen oder sind veraltet. Navigation angehalten. Vor dem Neustart besseren Empfang abwarten.');return;}
  if(!state||state.offset>45)return;
  try{
   if(activeDevice){
    if(googleMode&&state.remaining>mapsTotal){mapsTotal=state.remaining;sentInitial=false;}
    // Repeat the complete synthetic test once per second so a display that is
    // still opening its navigation view can receive the initial fields again.
    await exclusive(()=>getClient().updateNavigation(state,{total:displayTesting?300:googleMode?mapsTotal:route.length,initial:displayTesting||!sentInitial}));sentInitial=true;
   }
   if(active&&(state.arrived||googleMode&&state.icon===15))await stop('Ziel erreicht. Navigation beendet.');
  }catch(e){log(`Navigation: ${e.message}`,'ERROR');await stop(`Display-Übertragung fehlgeschlagen: ${e.message}`);}
 }
 async function start(withDisplay){
  if(active||working||isBusy()||!route)return;
  const startingClient=getClient();working=true;update();
  try{
   const p=await getPosition(),accuracy=usePosition(p);
   if(accuracy>40)throw new Error('Standort zu ungenau. Für die Navigation bitte auf einen besseren GPS-Empfang warten.');
   state=locate(route,location,progress);if(state.offset>45)throw new Error('Du bist nicht auf der geplanten Route. Route vom aktuellen Standort neu berechnen.');
   if(!withDisplay&&getClient()?.navigationStarted){setBusy(true);try{await getClient().stopNavigation();}finally{setBusy(false);}}
   if(withDisplay){
    if(getClient()!==startingClient||!startingClient?.authenticated||verifiedDevice!==startingClient.device.id)throw new Error('Verbindung geändert. Displaytest erneut durchführen.');
    setBusy(true);try{await startingClient.startNavigation();}finally{setBusy(false);}
   }
   active=true;activeDevice=withDisplay?getClient().device.id:null;sentInitial=false;progress=state.progress;lastFix=Date.now();lastWarning='';
   log(`Navigation gestartet (${withDisplay?'G3-Display experimentell':'nur Handy'}), ${fmt(route.length)}.`);
   try{wake=await navigator.wakeLock?.request('screen');}catch{log('Bildschirm bleibt eventuell nicht automatisch an.');}
   watch=navigator.geolocation.watchPosition(p=>{
    if(!active)return;
    try{
     const accuracy=usePosition(p);draw();
     if(accuracy>40){lastFix=0;warning('GPS zu ungenau. Keine neuen Display-Hinweise; besseren Empfang abwarten.');return;}
     const next=locate(route,location,progress);
     if(next.offset>45){lastFix=0;state=null;warning('Route verlassen. Anhalten, Navigation beenden und Route neu berechnen.');return;}
     state=next;progress=next.progress;lastFix=Date.now();lastWarning='';
     $('nav-instruction').textContent=`${next.instruction} · ${fmt(next.stepRemaining)}`;
     $('nav-road').textContent=next.nextRoad||'Dem Weg folgen';
     $('nav-remaining').textContent=`${fmt(next.remaining)} verbleibend · ca. ${Math.ceil(next.seconds/60)} min`;
     say(activeDevice?'Navigation läuft · Display-Übertragung experimentell.':'Navigation läuft auf dem Handy.');
     if(lastInstruction!==next.instruction){lastInstruction=next.instruction;log(`Navigation: ${next.instruction}.`);}
    }catch(e){lastFix=0;warning(e.message);}
   },e=>{lastFix=0;warning(`GPS-Fehler: ${e.message}. Keine neuen Display-Hinweise.`);},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
   timer=setInterval(()=>void tick(),1000);
  }catch(e){release();say(e.message);log(`Navigation: ${e.message}`,'ERROR');}
  finally{working=false;update();}
 }
 $('nav-location').addEventListener('click',()=>apiAction(async()=>{const p=await getPosition();usePosition(p);route=null;progress=null;say('Standort erfasst. Ziel wählen und Route berechnen.');draw();}));
 $('nav-query').addEventListener('input',()=>{destination=null;route=null;$('nav-results').replaceChildren();$('nav-route-summary').textContent='';draw();update();});
 $('nav-find').addEventListener('click',()=>apiAction(async signal=>{
  destination=null;route=null;draw();const q=$('nav-query').value.trim();if(q.length<2)throw new Error('Zieladresse oder Koordinaten „Breite, Länge“ eingeben.');
  const direct=parseCoordinates(q),list=$('nav-results');list.replaceChildren();
  const places=direct?[{display_name:q,lon:direct[0],lat:direct[1]}]:await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`,signal);
  if(!Array.isArray(places)||!places.length)throw new Error('Kein Ziel gefunden. Versuche eine genauere Adresse oder Koordinaten.');
  for(const p of places){const option=document.createElement('option');option.value=JSON.stringify([Number(p.lon),Number(p.lat)]);option.textContent=p.display_name;list.append(option);}
  list.selectedIndex=0;destination=JSON.parse(list.value);say('Ziel gefunden. Fahrradroute berechnen.');
 }));
 $('nav-results').addEventListener('change',()=>{destination=$('nav-results').value?JSON.parse($('nav-results').value):null;route=null;draw();update();});
 $('nav-plan').addEventListener('click',()=>apiAction(async signal=>{
  say('Fahrradroute wird berechnet …');route=null;progress=null;draw();
  const p=await getPosition();usePosition(p);
  const raw=await getJSON(`${ROUTER}${location.join(',')};${destination.join(',')}?overview=full&geometries=geojson&steps=true`,signal);
  const planned=makeRoute(raw);if(distance(location,planned.points[0])>100)throw new Error('Kein geeigneter Routenstart in deiner Nähe gefunden.');
  route=planned;$('nav-route-summary').textContent=`${fmt(route.length)} · ca. ${Math.ceil(route.duration/60)} min · Fahrradroute`;
  $('nav-instruction').textContent='Route bereit';$('nav-road').textContent='';$('nav-remaining').textContent='';draw();say('Route bereit. Handy-Navigation oder getestetes G3-Display starten.');log('Fahrradroute berechnet.');
 }));
 $('nav-phone').addEventListener('click',()=>void start(false));
 $('nav-start').addEventListener('click',()=>void start(true));
 $('nav-test').addEventListener('click',async()=>{
  if(working||active||isBusy()||!connected())return;
  const startingClient=getClient();testSent=false;testDevice=startingClient.device.id;verifiedDevice=null;$('nav-verified').checked=false;
  try{
   await exclusive(async()=>{
    working=true;update();
    log('Navigationstest: Start anfordern; danach 15 Sekunden lang jede Sekunde synthetische Testdaten senden.');
    say('Displaytest: auf Startbestätigung warten …');
    await startingClient.startNavigation();
    if(getClient()!==startingClient||!startingClient.authenticated)throw new Error('Verbindung während des Displaystarts geändert.');
    const testState={remaining:300,seconds:60,icon:2,stepRemaining:100,gps:1,currentRoad:'DISPLAYTEST',nextRoad:'TEST LINKS',offset:0};
    await startingClient.updateNavigation(testState,{total:300,initial:true});
    state=testState;
   });
   testSent=true;active=true;displayTesting=true;activeDevice=startingClient.device.id;sentInitial=true;testDeadline=Date.now()+15000;
   log('Navigationstest: erster vollständiger Datensatz gesendet; Wiederholung alle 1 s, maximal 15 s. Startton allein bestätigt keine Anzeige.');
   say('Displaytest läuft 15 Sekunden: Linkspfeil mit 100 m. Bei leerem Display danach den Log kopieren. „Navigation beenden“ bricht den Test ab.');
   timer=setInterval(()=>void tick(),1000);
  }catch(e){say(`Displaytest fehlgeschlagen: ${e.message}`);log(`Navigationstest: ${e.message}`,'ERROR');}
  finally{working=false;update();}
 });
 $('nav-verified').addEventListener('change',()=>{verifiedDevice=$('nav-verified').checked?getClient()?.device?.id:null;update();});
 $('nav-stop').addEventListener('click',()=>void stop());
 if(legacyMapsUI){
 $('maps-connect').addEventListener('click',()=>{try{maps.start();$('maps-bridge-status').textContent='Lokale Android-Brücke verbinden …';update();}catch(e){$('maps-bridge-status').textContent=e.message;}});
 $('maps-disconnect').addEventListener('click',async()=>{if(googleMode)await stop('Google-Maps-Übertragung beendet.');maps.stop();$('maps-bridge-status').textContent='Maps-Brücke getrennt.';update();});
 $('maps-start').addEventListener('click',async()=>{
  if(active||working||isBusy()||!maps.latest())return;
  try{
   await exclusive(()=>getClient().startNavigation());
   const latest=maps.latest();if(!latest)throw new Error('Google-Maps-Hinweis nicht mehr verfügbar.');
   active=true;googleMode=true;activeDevice=getClient().device.id;mapsTotal=latest.remaining;sentInitial=false;
   $('nav-map').hidden=true;say('Google Maps wird zum Display übertragen · experimentell.');log('Google-Maps-Displayübertragung gestartet.');
   try{wake=await navigator.wakeLock?.request('screen');}catch{}
   timer=setInterval(()=>void tick(),1000);await tick();
  }catch(e){await stop(e.message);log(`Google Maps: ${e.message}`,'ERROR');}
  finally{update();}
 });
 }
 document.addEventListener('visibilitychange',()=>{
  if(!active)return;
  if(document.hidden&&displayTesting){void stop('Displaytest beendet, weil der Tab im Hintergrund ist. Zum Testen im Vordergrund lassen.');return;}
  if(document.hidden){lastFix=0;warning('Tab im Hintergrund: GPS-/Bluetooth-Updates können pausieren. Vor Weiterfahrt im Vordergrund prüfen.');}
  else if(navigator.wakeLock&&!wake)navigator.wakeLock.request('screen').then(w=>{if(active)wake=w;else w.release();}).catch(()=>{});
 });
 window.addEventListener('pagehide',()=>{controller?.abort();maps.stop();release();});
 update();return {update,stop};
}
